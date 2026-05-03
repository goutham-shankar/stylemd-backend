import { connectDB, safeWrite } from "@/lib/mongodb";
import { StyleMdRun } from "@/backend/src/models/StyleMdRun";
import { ScrapedData } from "@/backend/src/models/ScrapedData";
import { canonicalPageUrl, pageUrlVariantsForLookup } from "@/lib/services/pageUrlCanonical";
import { stripLeadingModelPreamble } from "@/lib/services/styleMarkdownSanitize";
import { scrape } from "@/backend/src/services/scraper";
import { isValidScrapedRecord } from "@/backend/src/utils/validation";

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
  screenshot: string; // base64 ONLY
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
    status,
    updatedAt: now,
    title: input.title,
    description: input.description,
    h1: input.h1,
    canonical: input.canonical,
  };

  if (hasScreenshot) {
    runData.screenshot = screenshot;
    runData.images = [screenshot];
  }

  if (input.brandAssets) {
    runData.brandAssets = input.brandAssets;
  }

  // 🟠 UPSERT BY runId
  await safeWrite(() =>
    StyleMdRun.updateOne(
      { runId: input.runId },
      { $set: runData, $setOnInsert: { createdAt: new Date() } },
      { upsert: true }
    )
  );
  
  console.log("[persistStyleMdAfterGeneration] Persisted stylemd_runs (upsert)", { 
    runId: input.runId, 
    slug, 
    url: canonUrl 
  });

  return { slug };
}
