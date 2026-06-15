/**
 * BullMQ worker — runs the StyleMD pipeline, uploads to R2, mirrors metadata
 * to Mongo, then deletes the local .playground/<runId>/ scratch dir.
 *
 * Runs as a separate PM2 app so Playwright/Chromium OOMs can't take down the
 * HTTP API process.
 */
import "dotenv/config";
import { rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import mongoose from "mongoose";
import { Worker, UnrecoverableError } from "bullmq";

import { connection } from "@/lib/queue/redis";
import { SCRAPE_QUEUE, type ScrapeJobData, type ScrapeJobResult } from "@/lib/queue/types";
import {
  uploadR2,
  r2KeyFor,
  buildManifest,
  PIPELINE_VERSION,
  WORKER_VERSION,
  STORAGE_VERSION,
} from "@/lib/queue/r2";
import { connectDB, safeWrite } from "@/lib/mongodb";
import { runSimplifiedStyleMdPipeline } from "@/lib/stylemd-artifacts/simplifiedPipeline";
import { getStyleMdRunDir } from "@/lib/stylemd-artifacts/artifacts";
import { renderFromRunDir } from "./services/designSystemRenderer";
import { urlToSlug } from "./services/runStorage";
import { canonicalPageUrl } from "@/lib/services/pageUrlCanonical";
import { ScrapedData } from "./models/ScrapedData";
import { StyleMdRun } from "./models/StyleMdRun";

const CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || "2", 10);
const LOCK_DURATION = parseInt(process.env.WORKER_LOCK_MS || "300000", 10); // 5 min

function dataUrlToBuffer(dataUrl: string): { buffer: Buffer; contentType: string } | null {
  const m = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl);
  if (!m) return null;
  return { contentType: m[1], buffer: Buffer.from(m[2], "base64") };
}

/** Read a JSON file from the run dir; returns null if missing. */
async function readRunJson(runDir: string, name: string): Promise<string | null> {
  const path = join(runDir, name);
  if (!existsSync(path)) return null;
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

/** Read the full-page screenshot PNG from the run dir; returns null if missing. */
async function readRunScreenshot(runDir: string): Promise<Buffer | null> {
  const path = join(runDir, "full_screenshot.png");
  if (!existsSync(path)) return null;
  try {
    return await readFile(path);
  } catch {
    return null;
  }
}

async function start(): Promise<void> {
  console.log("---------------------------------------------------------------------------");
  console.log(`[worker] BUILD_ID: ${Date.now()}`);
  console.log(`[worker] Design Probe worker — concurrency=${CONCURRENCY}  storage=${STORAGE_VERSION}  pipeline=${PIPELINE_VERSION}`);
  console.log("---------------------------------------------------------------------------");

  await connectDB();

  const worker = new Worker<ScrapeJobData, ScrapeJobResult>(
    SCRAPE_QUEUE,
    async (job) => {
      const url = canonicalPageUrl(job.data.url);
      const provider = job.data.provider || "kimi";
      const debugMode = job.data.debugMode === true;
      const slug = urlToSlug(url);
      const t0 = Date.now();

      console.log(
        `[worker] job=${job.id} start url=${url} slug=${slug} provider=${provider}` +
          (debugMode ? " debugMode=true" : ""),
      );
      await job.updateProgress(5);

      // ── 1. Run pipeline → artifacts land in .playground/<runId>/ ──────────
      const result = await runSimplifiedStyleMdPipeline(url, provider, job.id!);
      const runDir = getStyleMdRunDir(result.runId);
      await job.updateProgress(70);

      // ── 2. Render preview.html + design.md ────────────────────────────────
      const rendered = await renderFromRunDir(runDir, url);
      if (!rendered) {
        throw new UnrecoverableError(`render produced no output for runDir=${runDir}`);
      }
      await job.updateProgress(80);

      // ── 3. Upload artifacts to R2 under websites/{slug}/ ─────────────────
      // Re-scrapes overwrite the previous files (same keys).
      // raw.html is debug-only in v2.1 — uploaded only when debugMode=true.
      const r2: Record<string, string> = {};

      r2.previewHtml = await uploadR2(
        r2KeyFor(slug, "previewHtml"),
        rendered.html,
        "text/html; charset=utf-8",
      );
      r2.designMd = await uploadR2(
        r2KeyFor(slug, "designMd"),
        rendered.md,
        "text/markdown; charset=utf-8",
      );

      // Screenshot — prefer the JPEG base64 from pipeline result; fall back to PNG on disk
      const shot = result.screenshot ? dataUrlToBuffer(result.screenshot) : null;
      if (shot) {
        r2.screenshot = await uploadR2(r2KeyFor(slug, "screenshot"), shot.buffer, shot.contentType);
      } else {
        const png = await readRunScreenshot(runDir);
        if (png) r2.screenshot = await uploadR2(r2KeyFor(slug, "screenshot"), png, "image/png");
      }

      // JSON sidecars from the run dir
      const semanticStructure = await readRunJson(runDir, "semantic_structure.json");
      if (semanticStructure) {
        r2.semanticStructure = await uploadR2(
          r2KeyFor(slug, "semanticStructure"),
          semanticStructure,
          "application/json",
        );
      }
      const semanticAnalysis = await readRunJson(runDir, "semantic_analysis.json");
      if (semanticAnalysis) {
        r2.designTokens = await uploadR2(
          r2KeyFor(slug, "designTokens"),
          semanticAnalysis,
          "application/json",
        );
      }

      // Debug-only: raw scraped HTML under debug/raw.html
      let debugRawUploaded = false;
      if (debugMode) {
        const rawHtml = await readRunJson(runDir, "raw.html");
        if (rawHtml) {
          await uploadR2(
            r2KeyFor(slug, "rawHtml"), // resolves to "websites/{slug}/debug/raw.html"
            rawHtml,
            "text/html; charset=utf-8",
          );
          debugRawUploaded = true;
        }
      }

      // ── manifest.json — self-describing index of the snapshot ──────────────
      // Always uploaded last so a successful manifest implies all artifacts
      // are in place. Path is `websites/{slug}/manifest.json` — NOT stored in
      // Mongo (always derivable from slug).
      const domain = (() => {
        try {
          return new URL(url).hostname;
        } catch {
          return slug;
        }
      })();
      const manifest = buildManifest({
        domain,
        slug,
        generatedAt: new Date(),
        has: {
          screenshot: Boolean(r2.screenshot),
          designTokens: Boolean(r2.designTokens),
          semanticStructure: Boolean(r2.semanticStructure),
          rawHtml: debugRawUploaded,
          // Brand asset uploads land in storage v2.2 — currently all null.
        },
      });
      await uploadR2(
        r2KeyFor(slug, "manifest"),
        JSON.stringify(manifest, null, 2),
        "application/json",
      );

      await job.updateProgress(90);

      // ── 4. Mirror lightweight metadata to Mongo ───────────────────────────
      const durationMs = Date.now() - t0;
      const r2Doc = {
        slug,
        previewHtml: r2.previewHtml || null,
        designMd: r2.designMd || null,
        screenshot: r2.screenshot || null,
        semanticStructure: r2.semanticStructure || null,
        designTokens: r2.designTokens || null,
        assets: {}, // populated by future pipeline stage when brand asset uploads land
      };
      const versions = {
        pipelineVersion: PIPELINE_VERSION,
        workerVersion: WORKER_VERSION,
        storageVersion: STORAGE_VERSION,
      };

      await safeWrite(() =>
        ScrapedData.updateOne(
          { url },
          {
            $set: {
              url,
              slug,
              status: "completed",
              runId: result.runId,
              durationMs,
              error: null,
              r2: r2Doc,
              ...versions,
              updatedAt: new Date(),
              lastScrapedAt: new Date(),
            },
            $setOnInsert: { createdAt: new Date() },
          },
          { upsert: true },
        ),
      );

      // StyleMdRun was upserted by the pipeline with analytics fields; we
      // patch in the R2 keys + versions + final status here.
      await safeWrite(() =>
        StyleMdRun.updateOne(
          { runId: result.runId },
          {
            $set: {
              slug,
              status: "completed",
              durationMs,
              r2: r2Doc,
              ...versions,
              updatedAt: new Date(),
              lastScrapedAt: new Date(),
            },
          },
        ),
      );

      await job.updateProgress(95);

      // ── 5. Delete local .playground/<runId>/ scratch dir ──────────────────
      // Local filesystem is temporary only. R2 is the durable store.
      try {
        await rm(runDir, { recursive: true, force: true });
        console.log(`[worker] cleaned ${runDir}`);
      } catch (e) {
        console.warn(
          `[worker] cleanup failed for ${runDir}:`,
          e instanceof Error ? e.message : String(e),
        );
      }

      await job.updateProgress(100);
      console.log(`[worker] job=${job.id} done in ${durationMs}ms runId=${result.runId}`);

      return { runId: result.runId, r2: r2Doc };
    },
    {
      connection,
      concurrency: CONCURRENCY,
      lockDuration: LOCK_DURATION,
      limiter: { max: 50, duration: 1000 },
    },
  );

  worker.on("active", (job) => console.log(`[worker] active   ${job.id}`));
  worker.on("completed", (job) => console.log(`[worker] complete ${job.id}`));
  worker.on("failed", (job, err) => {
    console.error(`[worker] failed   ${job?.id} attempts=${job?.attemptsMade} err=${err.message}`);
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      const url = canonicalPageUrl(job.data.url);
      safeWrite(() =>
        ScrapedData.updateOne(
          { url },
          { $set: { status: "failed", error: err.message, updatedAt: new Date() } },
        ),
      ).catch((e) => console.error("[worker] failure-mirror error:", e));
    }
  });
  worker.on("stalled", (jobId) => console.warn(`[worker] stalled  ${jobId}`));
  worker.on("error", (err) => console.error("[worker] error:", err.message));

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[worker] received ${signal}, draining…`);
    await worker.close();
    await mongoose.disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

start().catch((err) => {
  console.error("[worker] fatal error", err);
  process.exit(1);
});
