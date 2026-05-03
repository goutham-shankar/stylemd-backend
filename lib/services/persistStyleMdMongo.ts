import { connectMongo } from "@/lib/mongodb";
import { StyleMdRun } from "@/backend/src/models/StyleMdRun";
import { ScrapedData } from "@/backend/src/models/ScrapedData";
import { canonicalPageUrl, pageUrlVariantsForLookup } from "@/lib/services/pageUrlCanonical";
import { stripLeadingModelPreamble } from "@/lib/services/styleMarkdownSanitize";
import { scrape } from "@/backend/src/services/scraper";
import { isValidScrapedRecord } from "@/backend/src/utils/validation";

/**
 * Generate a URL-friendly slug from a URL (e.g. youtube.com → "youtube").
 */
export function slugFromUrl(rawUrl: string): string {
  try {
    const hostname = new URL(rawUrl).hostname;
    const parts = hostname.replace(/^www\./, "").split(".");
    const name = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
    return name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  } catch {
    return "unknown";
  }
}

export async function ensureUniqueSlug(base: string): Promise<string> {
  const existing = await StyleMdRun.findOne({ slug: base }).lean();
  if (!existing) return base;

  for (let i = 2; i <= 999; i++) {
    const candidate = `${base}-${i}`;
    const clash = await StyleMdRun.findOne({ slug: candidate }).lean();
    if (!clash) return candidate;
  }
  return `${base}-${Date.now()}`;
}

export type PersistStyleMdInput = {
  url: string;
  runId: string;
  provider: string;
  model: string;
  styleMd: string;
  screenshot: string; // base64 ONLY
  /** If omitted, derived via {@link ensureUniqueSlug}({@link slugFromUrl}(url)). */
  slug?: string;
  /** Stored as `status` on the run (e.g. completed_with_warnings, failed). Overrides inferred status. */
  runStatus?: string;
};

/**
 * Record an artifact-pipeline run as soon as it starts.
 */
export async function markStyleMdRunPendingInMongo(input: {
  url: string;
  runId: string;
  provider: string;
  model: string;
}): Promise<void> {
  await connectMongo();

  const canonUrl = canonicalPageUrl(input.url);
  const urlAliases = pageUrlVariantsForLookup(canonUrl);

  const existing = await StyleMdRun.findOne({ url: { $in: urlAliases } }).lean<{
    _id?: unknown;
    slug?: string;
  } | null>();
  const slug = existing?.slug?.trim() || (await ensureUniqueSlug(slugFromUrl(canonUrl)));

  const pending = {
    url: canonUrl, // Enforce canonical
    slug,
    runId: input.runId,
    provider: input.provider,
    model: input.model,
    status: "running",
    styleMd: "",
    images: [],
  };

  // 🟠 FIX 4: ENSURE SINGLE WRITE PATH
  await StyleMdRun.updateOne(
    { url: canonUrl },
    { $set: pending, $setOnInsert: { createdAt: new Date() } },
    { upsert: true }
  );
}

/**
 * Writes generated StyleMD to `stylemd_runs` and `scraped_data` (contentText).
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

  await connectMongo();

  const existing = await StyleMdRun.findOne({ url: { $in: pageUrlVariantsForLookup(canonUrl) } }).lean<{ slug?: string } | null>();
  const slug = input.slug ?? (existing?.slug?.trim() || (await ensureUniqueSlug(slugFromUrl(canonUrl))));
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

  const runData = {
    url: canonUrl, // Enforce canonical
    slug,
    runId: input.runId,
    provider: input.provider,
    model: input.model,
    styleMd,
    images: hasScreenshot ? [screenshot] : [],
    status,
    createdAt: now,
  };

  // 🟠 FIX 4: ENSURE SINGLE WRITE PATH
  await StyleMdRun.updateOne(
    { url: canonUrl },
    { $set: runData, $setOnInsert: { createdAt: new Date() } },
    { upsert: true }
  );
  console.log("[persistStyleMdAfterGeneration] Persisted stylemd_runs (upsert)", { runId: input.runId, slug, url: canonUrl });

  if (hasStyleMd) {
    const scrapedData = await scrape(canonUrl);

    const scrapedPayload = { 
      url: canonUrl, // Enforce canonical
      contentText: styleMd, 
      createdAt: now,
      ...(scrapedData ? {
        title: scrapedData.title,
        description: scrapedData.description,
        h1: scrapedData.h1,
        canonical: scrapedData.canonical,
        images: scrapedData.images,
        rawHtml: scrapedData.rawHtml,
      } : {
        images: hasScreenshot ? [screenshot] : [],
        rawHtml: ""
      })
    };
    
    // 🔴 FIX 1: REMOVE SILENT PERSISTENCE FAILURE
    if (!isValidScrapedRecord(scrapedPayload)) {
      console.error("[PERSIST] invalid scrape result, aborting", { url: canonUrl });
      throw new Error("Scrape produced invalid data");
    }

    console.log(`[DB] Saving to ScrapedData (upsert)...`);
    
    // 🟠 FIX 2: ENFORCE CANONICAL URL IN DB
    // 🟠 FIX 4: ENSURE SINGLE WRITE PATH
    await ScrapedData.updateOne(
      { url: canonUrl },
      { 
        $set: { ...scrapedPayload, url: canonUrl },
        $inc: { retryCount: 0 }, // Ensure field exists
        $setOnInsert: { createdAt: new Date() } 
      },
      { upsert: true }
    );
    
    // Reset retry count on successful write
    await ScrapedData.updateOne({ url: canonUrl }, { $set: { retryCount: 0 } });
    
    console.log(`[DB] Saved ScrapedData successfully for ${canonUrl}`);
  }

  return { slug };
}
