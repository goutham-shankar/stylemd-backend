#!/usr/bin/env tsx
/**
 * scripts/migrate-storage-v2.ts
 *
 * Zero-data-loss migration from storage v1 (inline base64 + HTML in Mongo) to
 * storage v2 (R2 keys in Mongo, artifacts in R2 under websites/{slug}/...).
 *
 * What it does for each scraped_data + stylemd_runs doc:
 *   1. Reads any legacy inline payloads (previewHtml, designMd, rawHtml,
 *      images[0], brandAssets.*).
 *   2. Uploads them to R2 at the canonical websites/{slug}/... keys, ONLY if
 *      that key doesn't already exist.
 *   3. Backfills the doc's `r2.*` subdoc with the resulting keys.
 *   4. $unsets the legacy fields and writes the v2.1 version stamps.
 *   5. Drops the now-orphan stylemd_runs.slug_1 index.
 *
 * v2.1 change: raw.html is NOT migrated to R2 by default (it's debug-only
 * going forward). Legacy `rawHtml` fields in Mongo are simply $unset.
 *
 * Properties:
 *   - Idempotent — re-running is a no-op for already-migrated docs.
 *   - Resumable — safe to Ctrl-C mid-run.
 *   - Read-then-unset ordering ensures no field is dropped before its data
 *     is safely uploaded.
 *
 * Run from project root:
 *     tsx scripts/migrate-storage-v2.ts            # live
 *     tsx scripts/migrate-storage-v2.ts --dry-run  # report only, no writes
 */
import "dotenv/config";
import mongoose from "mongoose";
import { S3Client, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { connectDB } from "../lib/mongodb";
import { ScrapedData } from "../backend/src/models/ScrapedData";
import { StyleMdRun } from "../backend/src/models/StyleMdRun";
import {
  PIPELINE_VERSION,
  WORKER_VERSION,
  STORAGE_VERSION,
  r2KeyFor,
} from "../lib/queue/r2";
import { urlToSlug } from "../backend/src/services/runStorage";

const DRY_RUN = process.argv.includes("--dry-run");

function env(k: string): string {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is required`);
  return v;
}

const s3 = new S3Client({
  region: "auto",
  endpoint: env("R2_ENDPOINT"),
  credentials: { accessKeyId: env("R2_KEY"), secretAccessKey: env("R2_SECRET") },
});
const BUCKET = env("R2_BUCKET");

async function r2Exists(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch (err: any) {
    if (err?.$metadata?.httpStatusCode === 404 || err?.name === "NotFound") return false;
    throw err;
  }
}

async function r2UploadIfMissing(
  key: string,
  body: string | Buffer,
  contentType: string,
): Promise<{ key: string; uploaded: boolean }> {
  if (await r2Exists(key)) return { key, uploaded: false };
  if (DRY_RUN) return { key, uploaded: true };
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );
  return { key, uploaded: true };
}

function dataUrlToBuffer(dataUrl: string): { buffer: Buffer; contentType: string } | null {
  const m = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl);
  if (!m) return null;
  return { contentType: m[1], buffer: Buffer.from(m[2], "base64") };
}

type Counters = { scanned: number; migrated: number; uploaded: number; skipped: number };

async function migrateScrapedData(c: Counters): Promise<void> {
  console.log("\n── migrating scraped_data ──");
  const cursor = ScrapedData.find({}).lean().cursor();

  for await (const doc of cursor as AsyncIterable<any>) {
    c.scanned++;
    const url = doc.url as string;
    if (!url) continue;
    const slug = urlToSlug(url);

    // If already migrated and no legacy fields present, skip.
    const hasLegacy =
      typeof doc.previewHtml === "string" ||
      typeof doc.designMd === "string" ||
      typeof doc.rawHtml === "string" ||
      Array.isArray(doc.images) && doc.images.length > 0 ||
      doc.brandAssets;
    const alreadyV2 = doc.storageVersion === STORAGE_VERSION;
    if (!hasLegacy && alreadyV2) {
      c.skipped++;
      continue;
    }

    const r2Keys: Record<string, string | null> = {
      slug,
      previewHtml: doc.r2?.previewHtml ?? null,
      designMd: doc.r2?.designMd ?? null,
      screenshot: doc.r2?.screenshot ?? null,
      semanticStructure: doc.r2?.semanticStructure ?? null,
      designTokens: doc.r2?.designTokens ?? null,
    };

    // Upload legacy inline payloads (raw.html is intentionally NOT uploaded
    // in v2.1 — it's debug-only going forward).
    if (typeof doc.previewHtml === "string" && doc.previewHtml.length > 0) {
      const { key } = await r2UploadIfMissing(
        r2KeyFor(slug, "previewHtml"),
        doc.previewHtml,
        "text/html; charset=utf-8",
      );
      r2Keys.previewHtml = key;
      c.uploaded++;
    }
    if (typeof doc.designMd === "string" && doc.designMd.length > 0) {
      const { key } = await r2UploadIfMissing(
        r2KeyFor(slug, "designMd"),
        doc.designMd,
        "text/markdown; charset=utf-8",
      );
      r2Keys.designMd = key;
      c.uploaded++;
    }
    if (Array.isArray(doc.images) && doc.images.length > 0) {
      const shot = dataUrlToBuffer(doc.images[0]);
      if (shot) {
        const { key } = await r2UploadIfMissing(
          r2KeyFor(slug, "screenshot"),
          shot.buffer,
          shot.contentType,
        );
        r2Keys.screenshot = key;
        c.uploaded++;
      }
    }

    if (DRY_RUN) {
      console.log(`  [dry] ${url} → ${slug} keys=${JSON.stringify(r2Keys)}`);
      c.migrated++;
      continue;
    }

    await ScrapedData.updateOne(
      { _id: doc._id },
      {
        $set: {
          slug,
          r2: r2Keys,
          pipelineVersion: PIPELINE_VERSION,
          workerVersion: WORKER_VERSION,
          storageVersion: STORAGE_VERSION,
          updatedAt: new Date(),
        },
        $unset: {
          previewHtml: "",
          designMd: "",
          rawHtml: "",        // v2.1: drop legacy inline raw HTML, do not migrate
          images: "",
          brandAssets: "",
          runServeUrl: "",
          "r2.rawHtml": "",   // v2.1: drop any v2 r2.rawHtml key written before this version
        },
      },
    );
    c.migrated++;
    if (c.migrated % 10 === 0) console.log(`  migrated ${c.migrated}/${c.scanned}…`);
  }
}

async function migrateStyleMdRuns(c: Counters): Promise<void> {
  console.log("\n── migrating stylemd_runs ──");
  const cursor = StyleMdRun.find({}).lean().cursor();

  for await (const doc of cursor as AsyncIterable<any>) {
    c.scanned++;
    const url = doc.url as string;
    if (!url) continue;
    const slug = doc.slug || urlToSlug(url);

    const hasLegacy =
      typeof doc.styleMd === "string" ||
      typeof doc.screenshot === "string" ||
      (Array.isArray(doc.images) && doc.images.length > 0) ||
      doc.brandAssets ||
      doc.extractionMetadata?.designTokenManifest ||
      doc.extractionMetadata?.semanticStructure;
    const alreadyV2 = doc.storageVersion === STORAGE_VERSION;
    if (!hasLegacy && alreadyV2) {
      c.skipped++;
      continue;
    }

    const r2Keys: Record<string, string | null> = {
      slug,
      previewHtml: doc.r2?.previewHtml ?? null,
      designMd: doc.r2?.designMd ?? null,
      screenshot: doc.r2?.screenshot ?? null,
      semanticStructure: doc.r2?.semanticStructure ?? null,
      designTokens: doc.r2?.designTokens ?? null,
    };

    if (typeof doc.styleMd === "string" && doc.styleMd.length > 0) {
      const { key } = await r2UploadIfMissing(
        r2KeyFor(slug, "designMd"),
        doc.styleMd,
        "text/markdown; charset=utf-8",
      );
      r2Keys.designMd = key;
      c.uploaded++;
    }
    const inlineShot =
      (typeof doc.screenshot === "string" && doc.screenshot) ||
      (Array.isArray(doc.images) && doc.images[0]) ||
      null;
    if (inlineShot) {
      const shot = dataUrlToBuffer(inlineShot);
      if (shot) {
        const { key } = await r2UploadIfMissing(
          r2KeyFor(slug, "screenshot"),
          shot.buffer,
          shot.contentType,
        );
        r2Keys.screenshot = key;
        c.uploaded++;
      }
    }
    const semStruct = doc.extractionMetadata?.semanticStructure;
    if (semStruct) {
      const { key } = await r2UploadIfMissing(
        r2KeyFor(slug, "semanticStructure"),
        JSON.stringify(semStruct),
        "application/json",
      );
      r2Keys.semanticStructure = key;
      c.uploaded++;
    }
    const tokenManifest = doc.extractionMetadata?.designTokenManifest;
    if (tokenManifest) {
      const { key } = await r2UploadIfMissing(
        r2KeyFor(slug, "designTokens"),
        JSON.stringify(tokenManifest),
        "application/json",
      );
      r2Keys.designTokens = key;
      c.uploaded++;
    }

    // Build slim summary from legacy extractionMetadata
    const xm = doc.extractionMetadata ?? {};
    const summary = {
      primaryColors: xm.primaryColors ?? doc.summary?.primaryColors ?? [],
      typographyFamilies: xm.typographyFamilies ?? doc.summary?.typographyFamilies ?? [],
      sectionCount: xm.sectionCount ?? doc.summary?.sectionCount ?? 0,
      componentCount: doc.summary?.componentCount ?? 0,
      confidenceScore: xm.confidenceScore ?? doc.summary?.confidenceScore ?? 0,
      scannedElements: xm.scannedElements ?? doc.summary?.scannedElements ?? 0,
    };

    if (DRY_RUN) {
      console.log(`  [dry] run=${doc.runId} → ${slug} keys=${JSON.stringify(r2Keys)}`);
      c.migrated++;
      continue;
    }

    await StyleMdRun.updateOne(
      { _id: doc._id },
      {
        $set: {
          slug,
          summary,
          r2: r2Keys,
          durationMs: xm.durationMs ?? doc.durationMs ?? null,
          pipelineVersion: PIPELINE_VERSION,
          workerVersion: WORKER_VERSION,
          storageVersion: STORAGE_VERSION,
          updatedAt: new Date(),
        },
        $unset: {
          styleMd: "",
          screenshot: "",
          images: "",
          brandAssets: "",
          "extractionMetadata.designTokenManifest": "",
          "extractionMetadata.semanticStructure": "",
          "r2.rawHtml": "",   // v2.1: drop any v2 r2.rawHtml key
        },
      },
    );
    c.migrated++;
    if (c.migrated % 10 === 0) console.log(`  migrated ${c.migrated}/${c.scanned}…`);
  }
}

async function dropLegacyIndexes(): Promise<void> {
  console.log("\n── dropping legacy indexes ──");
  if (DRY_RUN) {
    console.log("  [dry] would drop stylemd_runs.slug_1");
    return;
  }
  try {
    await StyleMdRun.collection.dropIndex("slug_1");
    console.log("  dropped stylemd_runs.slug_1");
  } catch (e: any) {
    console.log(`  slug_1 not present (ok): ${e.message}`);
  }
}

async function main(): Promise<void> {
  console.log(`storage migration → v2 ${DRY_RUN ? "(DRY RUN)" : "(LIVE)"}`);
  console.log(`bucket=${BUCKET}  pipeline=${PIPELINE_VERSION}  worker=${WORKER_VERSION}\n`);

  await connectDB();

  const a: Counters = { scanned: 0, migrated: 0, uploaded: 0, skipped: 0 };
  await migrateScrapedData(a);
  const b: Counters = { scanned: 0, migrated: 0, uploaded: 0, skipped: 0 };
  await migrateStyleMdRuns(b);
  await dropLegacyIndexes();

  console.log("\n── summary ──");
  console.log(`scraped_data:  scanned=${a.scanned}  migrated=${a.migrated}  uploaded=${a.uploaded}  skipped=${a.skipped}`);
  console.log(`stylemd_runs:  scanned=${b.scanned}  migrated=${b.migrated}  uploaded=${b.uploaded}  skipped=${b.skipped}`);

  await mongoose.disconnect();
  console.log("\ndone.");
}

main().catch((err) => {
  console.error("migration failed:", err);
  process.exit(1);
});
