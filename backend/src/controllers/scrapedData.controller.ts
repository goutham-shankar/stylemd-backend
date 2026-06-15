import type { Request, Response } from "express";
import { z } from "zod";
import { ScrapedData } from "../models/ScrapedData";
import { safeWrite } from "@/lib/mongodb";
import { canonicalPageUrl, pageUrlVariantsForLookup } from "@/lib/services/pageUrlCanonical";
import { isValidScrapedRecord } from "../utils/validation";
import { scrapeQueue } from "@/lib/queue/scrapeQueue";
import { urlToSlug } from "../services/runStorage";

// ---------------------------------------------------------------------------
// POST /api/scraped-data  { url }
// Enqueues a scrape job in BullMQ. Returns 202 + jobId. Worker process picks it up.
// ---------------------------------------------------------------------------

const postSchema = z.object({
  url: z.string().url(),
  provider: z.enum(["claude", "kimi"]).optional().default("kimi"),
  force: z.boolean().optional().default(false),
});

const MAX_WAITING = parseInt(process.env.QUEUE_MAX_WAITING || "500", 10);

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
    const urlNormalized = canonicalPageUrl(url);
    const tag = `[SCRAPE ${urlNormalized}]`;
    const t0 = Date.now();
    const elapsed = (): string => `+${Date.now() - t0}ms`;
    console.log(`${tag} request received force=${force}`);

    // ── Cache check — serve completed runs straight from Mongo ─────────────
    if (!force) {
      console.log(`${tag} cache lookup… ${elapsed()}`);
      const variants = pageUrlVariantsForLookup(urlNormalized);
      const existing = await ScrapedData.findOne({ url: { $in: variants } }).lean<{
        url: string;
        images: string[];
        contentText: string;
        rawHtml: string;
        previewHtml?: string;
        runServeUrl?: string;
        runId?: string;
        status?: string;
      } | null>();

      if (existing && isValidScrapedRecord(existing) && existing.previewHtml) {
        const kb = Math.round(Buffer.byteLength(existing.previewHtml, "utf-8") / 1024);
        console.log(`${tag} ✅ cache HIT — sending ${kb}KB preview.html ${elapsed()}`);
        res.set("Content-Type", "text/html; charset=utf-8").send(existing.previewHtml);
        return;
      }
      console.log(`${tag} cache MISS (existing=${!!existing}) ${elapsed()}`);
    }

    // ── Backpressure ───────────────────────────────────────────────────────
    console.log(`${tag} → getWaitingCount… ${elapsed()}`);
    const waiting = await scrapeQueue.getWaitingCount();
    console.log(`${tag} ← getWaitingCount=${waiting} ${elapsed()}`);
    if (waiting > MAX_WAITING) {
      console.warn(`${tag} ❌ queue full waiting=${waiting}`);
      res.status(429).json({ ok: false, error: "Queue is full. Please retry shortly.", waiting });
      return;
    }

    // ── Enqueue ────────────────────────────────────────────────────────────
    // BullMQ rejects ':' in custom job IDs, so we use '-' as the separator.
    const jobId = `scrape-${urlToSlug(urlNormalized)}`;

    console.log(`${tag} → getJob(${jobId})… ${elapsed()}`);
    const existingJob = await scrapeQueue.getJob(jobId);
    console.log(`${tag} ← getJob existing=${!!existingJob} ${elapsed()}`);

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

    console.log(`${tag} → queue.add… ${elapsed()}`);
    await scrapeQueue.add("scrape", { url: urlNormalized, provider }, { jobId });
    console.log(`${tag} ← queue.add done ${elapsed()}`);

    console.log(`${tag} → mongo upsert… ${elapsed()}`);
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
    console.log(`${tag} ← mongo upsert done ${elapsed()}`);

    console.log(`${tag} 🚀 enqueued jobId=${jobId} ${elapsed()}`);
    res.status(202).json({ ok: true, jobId, status: "queued", url: urlNormalized });
  } catch (err) {
    const status = err instanceof z.ZodError ? 400 : 500;
    res.status(status).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

export async function listScrapedData(req: Request, res: Response): Promise<void> {
  try {
    const { url } = req.query as { url?: string };

    if (url) {
      const variants = pageUrlVariantsForLookup(canonicalPageUrl(url));
      const doc = await ScrapedData.findOne({ url: { $in: variants } }).lean();
      if (doc) {
        res.json({ ok: true, data: doc });
        return;
      }
      res.json({ ok: true, data: null });
      return;
    }

    const data = await ScrapedData.find({}, { rawHtml: 0, previewHtml: 0, designMd: 0 })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}
