import { connectDB, safeWrite } from "@/lib/mongodb";
import { StyleMdRun } from "@/backend/src/models/StyleMdRun";
import { ScrapedData } from "@/backend/src/models/ScrapedData";
import { canonicalPageUrl, pageUrlVariantsForLookup } from "@/lib/services/pageUrlCanonical";
import { stripLeadingModelPreamble } from "@/lib/services/styleMarkdownSanitize";
import { scrape } from "@/backend/src/services/scraper";
import { isValidScrapedRecord } from "@/backend/src/utils/validation";
import { runIdLog } from "@/lib/stylemd-artifacts/helpers";
import type { KimiCostEstimate, KimiTokenUsage } from "@/lib/services/kimiUsage";

/**
 * Generate a deterministic, stable slug from a URL.
 * Stable across runs, not unique per execution.
 */
export function slugFromUrl(url: string): string {
  try {
    return new URL(url).hostname
      .replace("www.", "")
      .replace(".com", "")
      .replace(".in", "")
      .replace(".co", "")
      .replace(/[^a-z0-9]/g, "");
  } catch {
    return "unknown";
  }
}

/**
 * Record an artifact-pipeline run as soon as it starts.
 * Upsert is keyed by runId.
 */
export async function markStyleMdRunPendingInMongo(input: {
  url: string;
  runId: string;
  provider: string;
  model: string;
}): Promise<void> {
  const canonUrl = canonicalPageUrl(input.url);
  const slug = slugFromUrl(canonUrl);

  const pending = {
    url: canonUrl,
    slug,
    runId: input.runId,
    provider: input.provider,
    model: input.model,
    status: "running",
    styleMd: "",
    images: [],
    updatedAt: new Date(),
  };

  // 🟠 UPSERT BY runId
  await safeWrite(() => 
    StyleMdRun.updateOne(
      { runId: input.runId },
      { $set: pending, $setOnInsert: { createdAt: new Date() } },
      { upsert: true }
    )
  );
}

export type PersistStyleMdInput = {
  url: string;
  runId: string;
  provider: string;
  model: string;
  styleMd: string;
  designTokens?: Record<string, unknown> | null;
  screenshot: string; // base64 ONLY
  tokenUsage?: KimiTokenUsage | null;
  costEstimate?: KimiCostEstimate | null;
  slug?: string;
  runStatus?: string;
  brandAssets?: {
    logo?: string | null;
    favicon?: string | null;
    appleIcon?: string | null;
    ogImage?: string | null;
  };
  // Metadata fields
  title?: string | null;
  description?: string | null;
  h1?: string | null;
  canonical?: string | null;
  extractionMetadata?: {
    scannedElements?: number;
    durationMs?: number;
    confidenceScore?: number;
    primaryColors?: string[];
    typographyFamilies?: string[];
    sectionCount?: number;
    designTokenManifest?: any;
    semanticStructure?: any;
  };
};

/**
 * Writes generated StyleMD to `stylemd_runs`.
 * Upsert is keyed by runId.
 */
export async function persistStyleMdAfterGeneration(input: PersistStyleMdInput): Promise<{ slug: string }> {
  const canonUrl = canonicalPageUrl(input.url);
  const rawMd = stripLeadingModelPreamble(input.styleMd ?? "");
  const styleMd = rawMd.trim();
  let screenshot = input.screenshot?.trim() ?? "";

  // MongoDB 16MB document limit
  if (screenshot.length > 5 * 1024 * 1024) {
    console.warn(`[persistStyleMdAfterGeneration] Screenshot base64 is too large, dropping.`);
    screenshot = "";
  }

  const slug = input.slug || slugFromUrl(canonUrl);
  const now = new Date();
  const hasStyleMd = Boolean(styleMd);
  const hasScreenshot = Boolean(screenshot);
  
  const status =
    input.runStatus ??
    (!hasStyleMd && !hasScreenshot
      ? "failed"
      : hasStyleMd
        ? "completed"
        : "completed_with_warnings");

  const runData: any = {
    url: canonUrl,
    slug,
    runId: input.runId,
    provider: input.provider,
    model: input.model,
    styleMd,
    designTokens: input.designTokens ?? null,
    tokenUsage: input.tokenUsage ?? null,
    costEstimate: input.costEstimate ?? null,
    status,
    updatedAt: now,
    title: input.title,
    description: input.description,
    h1: input.h1,
    canonical: input.canonical,
    extractionMetadata: input.extractionMetadata,
  };

  if (hasScreenshot) {
    runData.screenshot = screenshot;
    runData.images = [screenshot];
  }

  if (input.brandAssets) {
    runData.brandAssets = input.brandAssets;
  }

  // 🟠 UPSERT BY runId
  const approxBsonSize = JSON.stringify(runData).length;
  runIdLog(input.runId, `[DEBUG] Persisting StyleMdRun. Approx BSON size: ${(approxBsonSize / 1024).toFixed(2)} KB. Fields: ${Object.keys(runData).join(", ")}`);
  
  if (approxBsonSize > 14 * 1024 * 1024) {
    runIdLog(input.runId, `[DEBUG] WARNING: Document is close to 16MB BSON limit (${(approxBsonSize / 1024 / 1024).toFixed(2)} MB)`, "warn");
  }

  try {
    await safeWrite(() =>
      StyleMdRun.updateOne(
        { runId: input.runId },
        { $set: runData, $setOnInsert: { createdAt: now } },
        { upsert: true }
      )
    );
    runIdLog(input.runId, `[DEBUG] Successfully persisted StyleMdRun (upsert)`);
    
    // Verification: Re-fetch to ensure no fields were stripped
    const verified = await StyleMdRun.findOne({ runId: input.runId }).lean();
    if (verified) {
      const savedKeys = Object.keys(verified);
      const missingKeys = Object.keys(runData).filter(k => !savedKeys.includes(k));
      if (missingKeys.length > 0) {
        runIdLog(input.runId, `[DEBUG] CRITICAL: Mongo/Mongoose stripped fields: ${missingKeys.join(", ")}`, "error");
      } else {
        runIdLog(input.runId, `[DEBUG] Persistence verified. All keys present in DB.`);
      }
    }
  } catch (dbErr) {
    runIdLog(input.runId, `[DEBUG] DB ERROR during upsert: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`, "error");
    throw dbErr;
  }

  return { slug };
}
