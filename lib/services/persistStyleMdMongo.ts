import { connectMongo } from "@/lib/mongodb";
import { StyleMdRun } from "@/backend/src/models/StyleMdRun";
import { ScrapedData } from "@/backend/src/models/ScrapedData";
import { canonicalPageUrl, pageUrlVariantsForLookup } from "@/lib/services/pageUrlCanonical";
import { stripLeadingModelPreamble } from "@/lib/services/styleMarkdownSanitize";
import { scrape } from "@/backend/src/services/scraper";

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
  screenshotUrl: string;
  screenshot: string;
  /** If omitted, derived via {@link ensureUniqueSlug}({@link slugFromUrl}(url)). */
  slug?: string;
  /** Stored as `status` on the run (e.g. completed_with_warnings, failed). Overrides inferred status. */
  runStatus?: string;
};

/**
 * Record an artifact-pipeline run as soon as it starts so `GET /api/stylemd/by-slug/:runId`
 * can resolve the `runId` before the pipeline finishes (avoids 404 race with the frontend).
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
    url: canonUrl,
    slug,
    runId: input.runId,
    provider: input.provider,
    model: input.model,
    status: "running",
    styleMd: "",
    screenshotUrl: "",
    screenshot: "",
  };

  if (existing?._id) {
    await StyleMdRun.updateOne({ _id: existing._id }, { $set: pending });
    return;
  }

  await StyleMdRun.updateOne(
    { url: canonUrl },
    { $set: pending, $setOnInsert: { createdAt: new Date() } },
    { upsert: true },
  );
}

/**
 * Writes generated StyleMD to `stylemd_runs` and `scraped_data` (contentText).
 * Always updates the run row so `running` placeholders from {@link markStyleMdRunPendingInMongo} are cleared.
 * `scraped_data` is updated only when `styleMd` is non-empty.
 */
export async function persistStyleMdAfterGeneration(input: PersistStyleMdInput): Promise<{ slug: string }> {
  const canonUrl = canonicalPageUrl(input.url);
  const rawMd = stripLeadingModelPreamble(input.styleMd ?? "");
  const styleMd = rawMd.trim();
  let screenshot = input.screenshot?.trim() ?? "";
  const screenshotUrl = input.screenshotUrl?.trim() ?? "";

  // MongoDB 16MB document limit: avoid storing huge base64 strings
  if (screenshot.length > 5 * 1024 * 1024) {
    console.warn(`[persistStyleMdAfterGeneration] Screenshot base64 is too large (${screenshot.length} bytes), dropping to prevent BSONObjectTooLarge error.`);
    screenshot = "";
  }

  await connectMongo();

  // Reuse existing record's slug (e.g., set by markStyleMdRunPendingInMongo) to prevent
  // ensureUniqueSlug from generating a new suffix ("levainbakery-2") for a URL that
  // already has a pending record with slug "levainbakery".
  const existingSlug =
    input.slug == null
      ? (
          await StyleMdRun.findOne({ url: { $in: pageUrlVariantsForLookup(canonUrl) } })
            .select("slug")
            .lean<{ slug?: string } | null>()
        )?.slug?.trim() ?? ""
      : "";

  const slug = input.slug ?? (existingSlug || (await ensureUniqueSlug(slugFromUrl(canonUrl))));
  const now = new Date();
  const hasStyleMd = Boolean(styleMd);
  const hasScreenshot = Boolean(screenshot) || Boolean(screenshotUrl);
  const status =
    input.runStatus ??
    (!hasStyleMd && !hasScreenshot
      ? "failed"
      : hasStyleMd
        ? "completed"
        : "completed_with_warnings");

  const runData = {
    url: canonUrl,
    slug,
    runId: input.runId,
    provider: input.provider,
    model: input.model,
    styleMd,
    screenshotUrl,
    screenshot,
    status,
    createdAt: now,
  };

  try {
    await StyleMdRun.create(runData);
    console.log("[persistStyleMdAfterGeneration] Saved stylemd_runs", { runId: input.runId, slug, url: canonUrl });
  } catch (dbErr: unknown) {
    const code = typeof dbErr === "object" && dbErr !== null && "code" in dbErr ? (dbErr as { code?: number }).code : undefined;
    if (code === 11000) {
      const hit = await StyleMdRun.findOne({
        url: { $in: pageUrlVariantsForLookup(canonUrl) },
      }).lean<{ _id?: unknown } | null>();
      if (hit?._id) {
        await StyleMdRun.updateOne({ _id: hit._id }, { $set: runData });
      } else {
        await StyleMdRun.updateOne({ url: canonUrl }, { $set: runData });
      }
      console.log("[persistStyleMdAfterGeneration] Upserted stylemd_runs (duplicate key)", { url: canonUrl });
    } else {
      throw dbErr;
    }
  }

  if (hasStyleMd) {
    const aliases = pageUrlVariantsForLookup(canonUrl);
    const scrapedHit = await ScrapedData.findOne({ url: { $in: aliases } })
      .sort({ createdAt: -1 })
      .lean<{ _id?: unknown } | null>();
    let scrapedData = null;
    try {
      scrapedData = await scrape(canonUrl);
    } catch (err) {
      console.error(`[ERROR] Failed to extract images/metadata via scrape during persist:`, err);
    }

    const scrapedPayload = { 
      url: canonUrl, 
      contentText: styleMd, 
      createdAt: now,
      ...(scrapedData ? {
        title: scrapedData.title,
        description: scrapedData.description,
        h1: scrapedData.h1,
        canonical: scrapedData.canonical,
        images: scrapedData.images,
      } : {})
    };
    
    console.log(`[DB] Saving to MongoDB...`);
    
    if (scrapedHit?._id) {
      await ScrapedData.updateOne({ _id: scrapedHit._id }, { $set: scrapedPayload });
      console.log(`[DB] Saved successfully, _id: ${scrapedHit._id}`);
    } else {
      try {
        const result = await ScrapedData.create(scrapedPayload);
        console.log(`[DB] Saved successfully, _id: ${result._id}`);
      } catch (again: unknown) {
        const c2 =
          typeof again === "object" && again !== null && "code" in again ?
            (again as { code?: number }).code
          : undefined;
        if (c2 === 11000) {
          const updated = await ScrapedData.findOneAndUpdate({ url: canonUrl }, { $set: scrapedPayload }, { new: true });
          if (updated) console.log(`[DB] Saved successfully, _id: ${updated._id}`);
        } else throw again;
      }
    }
  }

  return { slug };
}
