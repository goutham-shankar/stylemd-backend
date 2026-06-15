import type { Request, Response } from "express";
import { z } from "zod";
import { ScrapedData } from "../models/ScrapedData";
import { safeWrite } from "@/lib/mongodb";
import { canonicalPageUrl, pageUrlVariantsForLookup } from "@/lib/services/pageUrlCanonical";
import { scrapeQueue } from "@/lib/queue/scrapeQueue";
import { urlToSlug } from "../services/runStorage";
import { r2PublicUrl } from "@/lib/queue/r2";

// ---------------------------------------------------------------------------
// POST /api/scraped-data  { url }
//
// Cache hit: 302-redirect to the public R2 preview URL (storage v2 — the HTML
// no longer lives in Mongo). Cache miss: enqueue a scrape job in BullMQ and
// return 202 with jobId.
// ---------------------------------------------------------------------------

const postSchema = z.object({
  url: z.string().url(),
  provider: z.enum(["claude", "kimi"]).optional().default("kimi"),
  force: z.boolean().optional().default(false),
  /**
   * Storage v2.1: when true, the worker also uploads raw.html to
   * `websites/{slug}/debug/raw.html`. Off by default.
   */
  debugMode: z.boolean().optional().default(false),
});

const MAX_WAITING = parseInt(process.env.QUEUE_MAX_WAITING || "500", 10);

type ScrapedDoc = {
  url: string;
  status?: string | null;
  runId?: string | null;
  r2?: {
    slug?: string | null;
    previewHtml?: string | null;
    designMd?: string | null;
    screenshot?: string | null;
  } | null;
};

export async function createScrapedData(req: Request, res: Response): Promise<void> {
  try {
    const { url } = req.body as { url?: string };
    if (!url || typeof url !== "string") {
      res.status(400).json({ ok: false, error: "Invalid or missing URL" });
      return;
    }

    const parsed = postSchema.parse(req.body);
    const provider = parsed.provider;
    const force = parsed.force;
    const debugMode = parsed.debugMode;
    const urlNormalized = canonicalPageUrl(url);
    const tag = `[SCRAPE ${urlNormalized}]`;
    const t0 = Date.now();
    const elapsed = (): string => `+${Date.now() - t0}ms`;
    console.log(`${tag} request received force=${force}`);

    // ── Cache check — redirect to R2 if completed ────────────────────────
    if (!force) {
      const variants = pageUrlVariantsForLookup(urlNormalized);
      const existing = await ScrapedData.findOne({ url: { $in: variants } }).lean<ScrapedDoc | null>();

      if (existing?.status === "completed" && existing.r2?.previewHtml) {
        const publicUrl = r2PublicUrl(existing.r2.previewHtml);
        if (publicUrl) {
          console.log(`${tag} ✅ cache HIT — redirecting to ${publicUrl} ${elapsed()}`);
          res.redirect(302, publicUrl);
          return;
        }
      }
      console.log(`${tag} cache MISS (existing=${!!existing}, status=${existing?.status}) ${elapsed()}`);
    }

    // ── Backpressure ───────────────────────────────────────────────────────
    const waiting = await scrapeQueue.getWaitingCount();
    if (waiting > MAX_WAITING) {
      console.warn(`${tag} ❌ queue full waiting=${waiting}`);
      res.status(429).json({ ok: false, error: "Queue is full. Please retry shortly.", waiting });
      return;
    }

    // ── Enqueue ────────────────────────────────────────────────────────────
    // BullMQ rejects ':' in custom job IDs — use '-' as the separator.
    const jobId = `scrape-${urlToSlug(urlNormalized)}`;
    const existingJob = await scrapeQueue.getJob(jobId);

    if (existingJob && !force) {
      const state = await existingJob.getState();
      if (state === "waiting" || state === "active" || state === "delayed") {
        console.log(`${tag} ⏳ job already ${state} jobId=${jobId} — returning 202 ${elapsed()}`);
        res.status(202).json({
          ok: true,
          jobId,
          status: state,
          url: urlNormalized,
          message: "Job already in progress for this URL.",
        });
        return;
      }
    }
    if (existingJob && force) {
      console.log(`${tag} force=true → removing prior job ${jobId}`);
      await existingJob.remove().catch(() => undefined);
    }

    await scrapeQueue.add("scrape", { url: urlNormalized, provider, debugMode }, { jobId });

    await safeWrite(() =>
      ScrapedData.updateOne(
        { url: urlNormalized },
        {
          $set: { url: urlNormalized, runId: jobId, status: "queued", updatedAt: new Date() },
          $setOnInsert: { createdAt: new Date() },
        },
        { upsert: true },
      ),
    );

    console.log(`${tag} 🚀 enqueued jobId=${jobId} ${elapsed()}`);
    res.status(202).json({ ok: true, jobId, status: "queued", url: urlNormalized });
  } catch (err) {
    const status = err instanceof z.ZodError ? 400 : 500;
    res.status(status).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * GET /api/scraped-data?url=...   → returns single doc with R2 URLs resolved.
 * GET /api/scraped-data           → returns last 100 docs (metadata only).
 */
export async function listScrapedData(req: Request, res: Response): Promise<void> {
  try {
    const { url } = req.query as { url?: string };

    if (url) {
      const variants = pageUrlVariantsForLookup(canonicalPageUrl(url));
      const doc = await ScrapedData.findOne({ url: { $in: variants } }).lean<ScrapedDoc | null>();
      res.json({ ok: true, data: doc ? withR2Urls(doc) : null });
      return;
    }

    const docs = await ScrapedData.find({}).sort({ updatedAt: -1 }).limit(100).lean<ScrapedDoc[]>();
    res.json({ ok: true, data: docs.map(withR2Urls) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

/** Attach resolved public R2 URLs without mutating the stored keys. */
function withR2Urls(doc: ScrapedDoc & Record<string, unknown>): Record<string, unknown> {
  const r2 = doc.r2 ?? {};
  return {
    ...doc,
    r2Urls: {
      previewHtml: r2PublicUrl(r2.previewHtml),
      designMd: r2PublicUrl(r2.designMd),
      screenshot: r2PublicUrl(r2.screenshot),
    },
  };
}
