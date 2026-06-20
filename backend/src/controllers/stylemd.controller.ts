import type { Request, Response } from "express";
import { z } from "zod";
import { validateStyleMdProviderCredentials } from "@/lib/stylemd-artifacts/provider";
import { runSimplifiedStyleMdPipeline } from "@/lib/stylemd-artifacts/simplifiedPipeline";
import { connectDB, safeWrite } from "@/lib/mongodb";
import {
  slugFromUrl,
} from "@/lib/services/persistStyleMdMongo";
import { pageUrlVariantsForLookup, canonicalPageUrl } from "@/lib/services/pageUrlCanonical";
import { resolveStyleMdForRunDoc } from "@/lib/services/resolveStyleMdFromStores";
import { StyleMdRun } from "../models/StyleMdRun";
import { ScrapedData } from "../models/ScrapedData";
import { r2PublicUrl, fetchR2Text } from "@/lib/queue/r2";
import { finalizeStyleMdRun } from "../services/finalizeStyleMdRun";
import type { KimiCostEstimate, KimiTokenUsage } from "@/lib/services/kimiUsage";

import { runIdLog } from "@/lib/stylemd-artifacts/helpers";

/** R2 keys stored on a run/scrape doc (storage v2 — artifacts live in R2). */
interface R2Keys {
  slug?: string | null;
  previewHtml?: string | null;
  designMd?: string | null;
  screenshot?: string | null;
  semanticStructure?: string | null;
  designTokens?: string | null;
}

interface StyleMdRunDoc {
  url: string;
  slug?: string;
  runId?: string;
  provider?: string;
  model?: string;
  styleMd?: string;
  images?: string[];
  tokenUsage?: KimiTokenUsage | null;
  costEstimate?: KimiCostEstimate | null;
  status?: string;
  createdAt?: Date;
  retryCount?: number;
  contentText?: string;
  rawHtml?: string;
}

type ScrapedDocR2 = StyleMdRunDoc & { r2?: R2Keys | null };

/**
 * Build the cache-hit response payload for a completed run. styleMd text lives
 * in R2 (design.md) under storage v2, so we fetch it from there; preview/
 * screenshot are returned as resolved public R2 URLs.
 */
async function buildCachedPayload(
  existing: StyleMdRunDoc,
  r2: R2Keys | null,
): Promise<Record<string, unknown>> {
  const styleMd = (await fetchR2Text(r2?.designMd)) ?? existing.styleMd ?? "";
  return {
    url: existing.url,
    slug: existing.slug,
    runId: existing.runId,
    styleMd,
    images: existing.images ?? [],
    r2Urls: {
      previewHtml: r2PublicUrl(r2?.previewHtml),
      designMd: r2PublicUrl(r2?.designMd),
      screenshot: r2PublicUrl(r2?.screenshot),
    },
    tokenUsage: existing.tokenUsage ?? null,
    costEstimate: existing.costEstimate ?? null,
    provider: existing.provider,
    model: existing.model,
    status: existing.status,
    createdAt: (existing.createdAt as Date)?.toISOString?.() ?? String(existing.createdAt),
  };
}

const requestSchema = z.object({
  url: z.string().url(),
  provider: z.enum(["claude", "kimi"]).optional().default("kimi"),
  force: z.boolean().optional().default(false),
  userId: z.string().optional(),
});

export async function runStyleMd(req: Request, res: Response): Promise<void> {
  req.socket.setTimeout(0);
  res.setTimeout(0);

  try {
    const { url, provider, force, userId } = requestSchema.parse(req.body);
    const canonUrl = canonicalPageUrl(url);
    const slug = slugFromUrl(canonUrl);

    // --- Cache hit (find LATEST run for this URL) ---
    // Look up by canonical URL (+ www variants), NOT slug: two slug schemes
    // coexist in the codebase (slugFromUrl strips www/.com, urlToSlug keeps the
    // hostname) and finalize overwrites the doc's slug with the urlToSlug form,
    // so a slug query would miss. `url` is written identically by every path.
    const urlVariants = pageUrlVariantsForLookup(canonUrl);
    const existing = await StyleMdRun.findOne({ url: { $in: urlVariants } })
      .sort({ createdAt: -1 })
      .lean<StyleMdRunDoc>();

    // Storage v2: artifacts live in R2, NOT inline on the Mongo doc. A run is a
    // valid cache hit when it completed and produced R2 artifacts (preview/md).
    // The old check looked at existing.styleMd/images — fields v2 never writes —
    // so every lookup was a miss and re-scraped from scratch.
    const r2 = (existing as ScrapedDocR2 | undefined)?.r2 ?? null;
    const isValid = Boolean(
      existing &&
        (existing.status === "completed" || existing.status === "completed_with_warnings") &&
        (r2?.previewHtml || r2?.designMd),
    );

    console.log(`[STYLEMD] Checking cache for slug=${slug}. Found: ${existing ? "YES" : "NO"}, Valid: ${isValid ? "YES" : "NO"}, Force: ${force}`);

    if (!force && isValid && existing) {
      console.log(`[STYLEMD] cache-hit (valid) slug=${slug} — returning stored R2 artifacts, no re-scrape`);
      const cachedPayload = await buildCachedPayload(existing, r2);
      res.json({ ok: true, data: cachedPayload, cached: true });
      return;
    }

    if (existing?.status === "running") {
      res.status(409).json({
        ok: false,
        error: "A StyleMD run is already in progress for this website. Wait for it to finish.",
      });
      return;
    }

    // --- Credential check ---
    const credentialError = validateStyleMdProviderCredentials(provider);
    if (credentialError) {
      res.status(400).json({ ok: false, error: credentialError });
      return;
    }

    // --- Run the pipeline in background ---
    // Generate a runId here so we can return it immediately
    const runIdValue = `stylemd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    
    // 🟢 Create the pending record BEFORE responding, so getBySlug always finds it
    try {
      await safeWrite(() =>
        StyleMdRun.updateOne(
          { runId: runIdValue },
          {
            $set: {
              url: canonUrl,
              slug,
              runId: runIdValue,
              provider,
              status: "running",
              styleMd: "",
              images: [],
              updatedAt: new Date(),
            },
            $setOnInsert: { createdAt: new Date() },
          },
          { upsert: true }
        )
      );
    } catch (pendingErr) {
      console.warn(`[runStyleMd] Failed to create pending record: ${pendingErr instanceof Error ? pendingErr.message : String(pendingErr)}`);
    }

    // Respond immediately — frontend can now poll and will find the "running" record
    res.json({
      ok: true,
      runId: runIdValue,
      slug,
      status: "running"
    });

    // Start pipeline without awaiting
    const startedAt = Date.now();
    void (async () => {
      try {
        const result = await runSimplifiedStyleMdPipeline(canonUrl, provider, runIdValue);

        // Finalize: render → upload artifacts to R2 → patch the run doc with R2
        // keys → clean scratch dir. Without this, /api/stylemd runs never get
        // R2 keys persisted, so they're neither retrievable nor cache-hittable.
        await finalizeStyleMdRun({
          runId: result.runId,
          url: canonUrl,
          durationMs: Date.now() - startedAt,
          screenshotDataUrl: result.screenshot,
          userId,
        });

        // Reset retry count on success
        await safeWrite(() => StyleMdRun.updateOne({ runId: result.runId }, { $set: { retryCount: 0 } }));

        runIdLog(result.runId, `[DEBUG] Pipeline completed successfully. styleMdLength=${result.styleMd?.length ?? 0}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[runStyleMd] Pipeline background error for ${runIdValue}:`, message);
        await safeWrite(() =>
          StyleMdRun.updateOne(
            { runId: runIdValue },
            { $set: { status: "failed", error: message, updatedAt: new Date() } },
          ),
        ).catch(() => undefined);
      }
    })();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[runStyleMd] error:", message);
    if (!res.headersSent) {
      res.status(400).json({ ok: false, error: message });
    }
  }
}

/** GET /api/stylemd/by-slug/:slug */
export async function getBySlug(req: Request, res: Response): Promise<void> {
  try {
    const { slug } = req.params as { slug: string };

    // Ensure DB connection is live — this is a read-only route that may be called
    // before any write route has established the connection (e.g. deep links).
    try { await connectDB(); } catch { /* proceed — connection may already be open */ }

    // Check by slug, runId, and normalized hostname slug so both
    // /by-slug/fitgreenmind and /by-slug/stylemd_1778…  work.
    const normalizedSlug = slugFromUrl(slug.includes(".") ? `https://${slug}` : slug);

    const doc = await StyleMdRun.findOne({
      $or: [
        { slug },
        { runId: slug },
        ...(normalizedSlug !== "unknown" ? [{ slug: normalizedSlug }] : []),
      ],
    })
    .sort({ createdAt: -1 })
    .lean<StyleMdRunDoc>();

    if (!doc) {
      console.warn(`[getBySlug] No run found for slug/runId/normalized: ${slug} / ${normalizedSlug}`);
      res.status(404).json({ ok: false, error: `No run found for slug: ${slug}` });
      return;
    }

    if (doc.status === "running") {
      console.log(`[PIPELINE_PENDING] Pipeline running for slug=${slug}. [STYLEGUIDE_NOT_READY]`);
      // Include a data envelope so fetchRunBySlugOrId (which checks !j.data) returns non-null
      // and the frontend retry loop can correctly detect the "still running" state.
      res.json({
        ok: true,
        data: {
          runId: doc.runId,
          slug: doc.slug,
          url: doc.url,
          styleMd: "",
          images: [],
          tokenUsage: doc.tokenUsage ?? null,
          costEstimate: doc.costEstimate ?? null,
          provider: doc.provider,
          model: doc.model,
          status: "processing",
          pending: true,
          createdAt: (doc.createdAt as Date)?.toISOString?.() ?? String(doc.createdAt),
        },
      });
      return;
    }

    // Storage v2: design.md lives in R2. Prefer it; fall back to the legacy
    // inline/contentText resolver for pre-migration runs.
    const r2 = (doc as ScrapedDocR2).r2 ?? null;
    const styleMd = (await fetchR2Text(r2?.designMd)) || (await resolveStyleMdForRunDoc(doc));
    if (r2?.designMd && styleMd) {
      console.log(`[CANONICAL_ARTIFACT_FOUND] Resolved styleMd from R2 for ${slug}. Length: ${styleMd.length}.`);
    } else {
      console.log(`[FALLBACK_TRIGGERED] Resolved styleMd for ${slug}. Length: ${styleMd.length}. (Source was fallback)`);
    }

    res.json({
      ok: true,
      data: {
        url: doc.url,
        slug: doc.slug,
        runId: doc.runId,
        styleMd,
        r2Urls: {
          previewHtml: r2PublicUrl(r2?.previewHtml),
          designMd: r2PublicUrl(r2?.designMd),
          screenshot: r2PublicUrl(r2?.screenshot),
        },
        designTokens: (doc as any).designTokens ?? null,
        images: doc.images ?? [],
        tokenUsage: doc.tokenUsage ?? null,
        costEstimate: doc.costEstimate ?? null,
        title: (doc as any).title,
        description: (doc as any).description,
        h1: (doc as any).h1,
        canonical: (doc as any).canonical,
        brandAssets: (doc as any).brandAssets,
        screenshot: r2PublicUrl(r2?.screenshot) ?? (doc as any).screenshot,
        provider: doc.provider,
        model: doc.model,
        status: doc.status,
        createdAt: (doc.createdAt as Date)?.toISOString?.() ?? String(doc.createdAt),
      },
    });
  } catch (err) {
    console.error("[getBySlug] error:", err instanceof Error ? err.message : String(err));
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

/** GET /api/stylemd/runs */
export async function listStyleMdRuns(req: Request, res: Response): Promise<void> {
  try {
    const runs = await StyleMdRun.find({})
      .sort({ createdAt: -1 })
      .select("url slug runId provider model status createdAt title brandAssets tokenUsage costEstimate")
      .lean<StyleMdRunDoc[]>();

    res.json({
      ok: true,
      data: runs.map((r) => ({
        id: r.runId ?? r.slug ?? r.url,
        url: r.url,
        slug: r.slug,
        title: (r as any).title,
        brandAssets: (r as any).brandAssets,
        provider: r.provider ?? "kimi",
        model: r.model,
        status: r.status ?? "completed",
        tokenUsage: r.tokenUsage ?? null,
        costEstimate: r.costEstimate ?? null,
        createdAt: (r.createdAt as Date)?.toISOString?.() ?? String(r.createdAt),
      })),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message: String(err) });
  }
}

