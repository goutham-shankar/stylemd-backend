import { safeWrite } from "@/lib/mongodb";
import { StyleMdRun } from "@/backend/src/models/StyleMdRun";
import { canonicalPageUrl } from "@/lib/services/pageUrlCanonical";
import { stripLeadingModelPreamble } from "@/lib/services/styleMarkdownSanitize";
import { runIdLog } from "@/lib/stylemd-artifacts/helpers";
import type { KimiCostEstimate, KimiTokenUsage } from "@/lib/services/kimiUsage";

/**
 * Generate a deterministic, stable slug from a URL.
 * Stable across runs, not unique per execution.
 */
export function slugFromUrl(url: string): string {
  try {
    let host = new URL(url).hostname;
    if (host.startsWith("www.")) host = host.slice(4);
    host = host.replace(/\.[^.]+$/, "");
    return host.replace(/[^a-z0-9]/g, "") || "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Record an artifact-pipeline run as soon as it starts.
 * Upsert is keyed by runId.
 *
 * Storage v2: lightweight metadata only. styleMd text + images + screenshot
 * never written to Mongo — they live in R2 keyed by slug.
 */
export async function markStyleMdRunPendingInMongo(input: {
  url: string;
  runId: string;
  provider: string;
  model: string;
  userId?: string;
}): Promise<void> {
  const canonUrl = canonicalPageUrl(input.url);
  const slug = slugFromUrl(canonUrl);

  const update: Record<string, unknown> = {
    $set: {
      url: canonUrl,
      slug,
      runId: input.runId,
      provider: input.provider,
      model: input.model,
      status: "running",
      updatedAt: new Date(),
    },
    $setOnInsert: { createdAt: new Date() },
  };
  if (input.userId) {
    (update as any).$addToSet = { userIds: input.userId };
  }

  await safeWrite(() =>
    StyleMdRun.updateOne({ runId: input.runId }, update, { upsert: true }),
  );
}

export type PersistStyleMdInput = {
  url: string;
  runId: string;
  provider: string;
  model: string;
  styleMd: string;
  designTokens?: Record<string, unknown> | null;
  screenshot: string; // base64 — held in memory for the worker to upload to R2
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
 * Writes generated StyleMD pipeline analytics to `stylemd_runs` (slim — storage v2).
 *
 * What lives in Mongo: tokens, cost, design-token summary, lightweight metadata.
 * What lives in R2: styleMd text, base64 screenshot, brand assets, full
 * design-token manifest, semantic structure. The worker uploads them and patches
 * in `r2.*` keys after this call returns.
 */
export async function persistStyleMdAfterGeneration(
  input: PersistStyleMdInput,
): Promise<{ slug: string }> {
  const canonUrl = canonicalPageUrl(input.url);
  const rawMd = stripLeadingModelPreamble(input.styleMd ?? "");
  const styleMd = rawMd.trim();
  const slug = input.slug || slugFromUrl(canonUrl);
  const now = new Date();
  const hasStyleMd = Boolean(styleMd);
  const hasScreenshot = Boolean(input.screenshot);

  const status =
    input.runStatus ??
    (!hasStyleMd && !hasScreenshot
      ? "failed"
      : hasStyleMd
        ? "completed"
        : "completed_with_warnings");

  // Compact summary derived from the heavy extractionMetadata (which itself
  // does NOT get persisted — too big).
  const xm = input.extractionMetadata ?? {};
  const summary = {
    primaryColors: xm.primaryColors ?? [],
    typographyFamilies: xm.typographyFamilies ?? [],
    sectionCount: xm.sectionCount ?? 0,
    componentCount: 0,
    confidenceScore: xm.confidenceScore ?? 0,
    scannedElements: xm.scannedElements ?? 0,
  };

  const runData: Record<string, unknown> = {
    url: canonUrl,
    slug,
    runId: input.runId,
    provider: input.provider,
    model: input.model,
    status,
    title: input.title ?? null,
    description: input.description ?? null,
    h1: input.h1 ?? null,
    canonical: input.canonical ?? null,
    designTokens: input.designTokens ?? null,
    tokenUsage: input.tokenUsage ?? null,
    costEstimate: input.costEstimate ?? null,
    summary,
    durationMs: xm.durationMs ?? null,
    updatedAt: now,
  };

  const approxBsonSize = JSON.stringify(runData).length;
  runIdLog(
    input.runId,
    `[DEBUG] Persisting StyleMdRun (slim). Approx BSON size: ${(approxBsonSize / 1024).toFixed(2)} KB.`,
  );

  try {
    await safeWrite(() =>
      StyleMdRun.updateOne(
        { runId: input.runId },
        { $set: runData, $setOnInsert: { createdAt: now } },
        { upsert: true },
      ),
    );
    runIdLog(input.runId, `[DEBUG] StyleMdRun persisted (worker will patch r2 keys next).`);
  } catch (dbErr) {
    runIdLog(
      input.runId,
      `[DEBUG] DB ERROR during upsert: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`,
      "error",
    );
    throw dbErr;
  }

  return { slug };
}
