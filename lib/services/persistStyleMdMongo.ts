import { connectMongo } from "@/lib/mongodb";
import { StyleMdRun } from "@/backend/src/models/StyleMdRun";
import { ScrapedData } from "@/backend/src/models/ScrapedData";

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

  const existing = await StyleMdRun.findOne({ url: input.url }).lean<{ slug?: string } | null>();
  const slug = existing?.slug?.trim() || (await ensureUniqueSlug(slugFromUrl(input.url)));

  await StyleMdRun.updateOne(
    { url: input.url },
    {
      $set: {
        url: input.url,
        slug,
        runId: input.runId,
        provider: input.provider,
        model: input.model,
        status: "running",
        styleMd: "",
        screenshotUrl: "",
        screenshot: "",
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true },
  );
}

/**
 * Writes generated StyleMD to `stylemd_runs` and `scraped_data` (contentText).
 * Always updates the run row so `running` placeholders from {@link markStyleMdRunPendingInMongo} are cleared.
 * `scraped_data` is updated only when `styleMd` is non-empty.
 */
export async function persistStyleMdAfterGeneration(input: PersistStyleMdInput): Promise<{ slug: string }> {
  const styleMd = input.styleMd?.trim() ?? "";
  const screenshot = input.screenshot?.trim() ?? "";
  const screenshotUrl = input.screenshotUrl?.trim() ?? "";

  await connectMongo();

  const slug = input.slug ?? (await ensureUniqueSlug(slugFromUrl(input.url)));
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
    url: input.url,
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
    console.log("[persistStyleMdAfterGeneration] Saved stylemd_runs", { runId: input.runId, slug, url: input.url });
  } catch (dbErr: unknown) {
    const code = typeof dbErr === "object" && dbErr !== null && "code" in dbErr ? (dbErr as { code?: number }).code : undefined;
    if (code === 11000) {
      await StyleMdRun.updateOne({ url: input.url }, { $set: runData });
      console.log("[persistStyleMdAfterGeneration] Upserted stylemd_runs (duplicate key)", { url: input.url });
    } else {
      throw dbErr;
    }
  }

  if (hasStyleMd) {
    await ScrapedData.findOneAndUpdate(
      { url: input.url },
      {
        url: input.url,
        contentText: styleMd,
        createdAt: now,
      },
      { upsert: true, new: true },
    );
  }

  return { slug };
}
