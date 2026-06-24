/**
 * Shared "finish line" for a StyleMD pipeline run: render preview.html +
 * design.md, upload every artifact to R2, patch Mongo with the resulting
 * keys, then delete the local .playground/<runId>/ scratch dir.
 *
 * runSimplifiedStyleMdPipeline() only generates content in-memory and writes
 * slim analytics to Mongo — it deliberately leaves this step to the caller
 * (see the comment in simplifiedPipeline.ts: "HTML/markdown/screenshots are
 * uploaded to R2 by the worker after this pipeline completes"). Both the
 * BullMQ worker and the direct /api/stylemd path call this function so a run
 * is actually retrievable afterwards regardless of which path produced it.
 */
import { rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  uploadR2,
  r2KeyFor,
  buildManifest,
  PIPELINE_VERSION,
  WORKER_VERSION,
  STORAGE_VERSION,
} from "@/lib/queue/r2";
import { safeWrite } from "@/lib/mongodb";
import { getStyleMdRunDir } from "@/lib/stylemd-artifacts/artifacts";
import { renderFromRunDir } from "./designSystemRenderer";
import { urlToSlug } from "./runStorage";
import { ScrapedData } from "../models/ScrapedData";
import { StyleMdRun } from "../models/StyleMdRun";
import { User } from "../models/User";
import { sendScrapeCompleteEmail } from "./email";

export interface FinalizeStyleMdRunInput {
  runId: string;
  url: string;
  durationMs: number;
  screenshotDataUrl?: string | null;
  debugMode?: boolean;
  userId?: string;
  userEmail?: string;
  source?: "library" | "volt" | "scrape";
}

export interface R2Doc {
  slug: string;
  previewHtml: string | null;
  designMd: string | null;
  screenshot: string | null;
  semanticStructure: string | null;
  designTokens: string | null;
  assets: Record<string, string>;
}

function dataUrlToBuffer(dataUrl: string): { buffer: Buffer; contentType: string } | null {
  const m = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl);
  if (!m) return null;
  return { contentType: m[1], buffer: Buffer.from(m[2], "base64") };
}

async function readRunJson(runDir: string, name: string): Promise<string | null> {
  const path = join(runDir, name);
  if (!existsSync(path)) return null;
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

async function readRunScreenshot(runDir: string): Promise<Buffer | null> {
  const path = join(runDir, "full_screenshot.png");
  if (!existsSync(path)) return null;
  try {
    return await readFile(path);
  } catch {
    return null;
  }
}

export async function finalizeStyleMdRun(input: FinalizeStyleMdRunInput): Promise<R2Doc> {
  const { runId, url, durationMs, debugMode = false, userId, source = "scrape" } = input;
  const runDir = getStyleMdRunDir(runId);
  const slug = urlToSlug(url);

  const rendered = await renderFromRunDir(runDir, url);
  if (!rendered) {
    throw new Error(`render produced no output for runDir=${runDir}`);
  }

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

  const shot = input.screenshotDataUrl ? dataUrlToBuffer(input.screenshotDataUrl) : null;
  if (shot) {
    r2.screenshot = await uploadR2(r2KeyFor(slug, "screenshot"), shot.buffer, shot.contentType);
  } else {
    const png = await readRunScreenshot(runDir);
    if (png) r2.screenshot = await uploadR2(r2KeyFor(slug, "screenshot"), png, "image/png");
  }

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

  let debugRawUploaded = false;
  if (debugMode) {
    const rawHtml = await readRunJson(runDir, "raw.html");
    if (rawHtml) {
      await uploadR2(r2KeyFor(slug, "rawHtml"), rawHtml, "text/html; charset=utf-8");
      debugRawUploaded = true;
    }
  }

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
    },
  });
  await uploadR2(r2KeyFor(slug, "manifest"), JSON.stringify(manifest, null, 2), "application/json");

  const r2Doc: R2Doc = {
    slug,
    previewHtml: r2.previewHtml || null,
    designMd: r2.designMd || null,
    screenshot: r2.screenshot || null,
    semanticStructure: r2.semanticStructure || null,
    designTokens: r2.designTokens || null,
    assets: {},
  };
  let userEmail = input.userEmail;
  if (!userEmail) {
    try {
      const existingRun = await StyleMdRun.findOne({ runId }).select("userEmail").lean<{ userEmail?: string } | null>();
      if (existingRun?.userEmail) {
        userEmail = existingRun.userEmail;
      } else {
        const existingScraped = await ScrapedData.findOne({ url }).select("userEmail").lean<{ userEmail?: string } | null>();
        if (existingScraped?.userEmail) {
          userEmail = existingScraped.userEmail;
        }
      }
    } catch (e) {
      console.warn("[finalizeStyleMdRun] Failed to resolve fallback email from database:", e);
    }
  }

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
          runId,
          durationMs,
          error: null,
          r2: r2Doc,
          ...versions,
          updatedAt: new Date(),
          lastScrapedAt: new Date(),
          ...(userEmail ? { userEmail, email: userEmail } : {}),
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true },
    ),
  );

  await safeWrite(() =>
    StyleMdRun.updateOne(
      { runId },
      {
        $set: {
          slug,
          status: "completed",
          source,
          durationMs,
          r2: r2Doc,
          ...versions,
          updatedAt: new Date(),
          lastScrapedAt: new Date(),
          ...(userEmail ? { userEmail, email: userEmail } : {}),
        },
        ...(userId ? { $addToSet: { userIds: userId } } : {}),
      },
    ),
  );

  const triggerEmail = (emailAddr: string) => {
    const hostname = (() => {
      try { return new URL(url).hostname; } catch { return slug; }
    })();
    console.log(`[finalizeStyleMdRun] sending scrape-complete email to ${emailAddr} for ${hostname}`);
    sendScrapeCompleteEmail(emailAddr, {
      hostname,
      slug,
      screenshotUrl: r2Doc.screenshot,
      durationMs,
      completedAt: new Date().toISOString(),
    }).then(() => {
      console.log(`[finalizeStyleMdRun] scrape-complete email sent to ${emailAddr}`);
    }).catch((e) =>
      console.error("[finalizeStyleMdRun] scrape-complete email failed:", e instanceof Error ? e.message : e),
    );
  };

  if (userEmail) {
    triggerEmail(userEmail);
  } else if (userId) {
    console.log(`[finalizeStyleMdRun] userId=${userId} — looking up user for scrape-complete email`);
    const user = await User.findOne({ uid: userId }).lean();
    if (user?.email) {
      triggerEmail(user.email);
    } else {
      console.warn(`[finalizeStyleMdRun] user not found or no email for uid=${userId}`);
    }
  } else {
    console.log(`[finalizeStyleMdRun] no userId or userEmail — skipping scrape-complete email`);
  }

  try {
    await rm(runDir, { recursive: true, force: true });
  } catch (e) {
    console.warn(
      `[finalizeStyleMdRun] cleanup failed for ${runDir}:`,
      e instanceof Error ? e.message : String(e),
    );
  }

  return r2Doc;
}
