import { ScrapedData } from "@/backend/src/models/ScrapedData";
import { pageUrlVariantsForLookup } from "@/lib/services/pageUrlCanonical";
import { stripLeadingModelPreamble } from "@/lib/services/styleMarkdownSanitize";

export type StyleMdRunDocLike = {
  url: string;
  styleMd?: string | null;
};

interface ScrapedLean {
  url?: string;
  contentText?: string | null;
}

/**
 * Prefer `stylemd_runs.styleMd`; if empty, mirror `scraped_data.contentText` (URL variants).
 */
export async function resolveStyleMdForRunDoc(doc: StyleMdRunDocLike): Promise<string> {
  const primary = doc.styleMd?.trim() ?? "";
  if (primary) return stripLeadingModelPreamble(primary);

  const urls = pageUrlVariantsForLookup(doc.url);
  const scraped = await ScrapedData.findOne({
    url: { $in: urls },
    contentText: { $nin: [null, ""] },
  })
    .sort({ createdAt: -1 })
    .lean<ScrapedLean | null>()
    .catch(() => null);

  const fallback = scraped?.contentText?.trim() ?? "";
  return stripLeadingModelPreamble(fallback || "");
}
