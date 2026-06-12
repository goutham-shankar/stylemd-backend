import type { Request, Response } from "express";
import { z } from "zod";
import { join } from "node:path";
import { ScrapedData } from "../models/ScrapedData";
import { safeWrite } from "@/lib/mongodb";
import { canonicalPageUrl, pageUrlVariantsForLookup } from "@/lib/services/pageUrlCanonical";
import { isValidScrapedRecord } from "../utils/validation";
import { runSimplifiedStyleMdPipeline } from "@/lib/stylemd-artifacts/simplifiedPipeline";
import { getStyleMdRunDir } from "@/lib/stylemd-artifacts/artifacts";
import { saveRunHtml, saveRunDesignMd } from "../services/runStorage";
import { renderFromRunDir } from "../services/designSystemRenderer";

// ---------------------------------------------------------------------------
// POST /api/scraped-data  { url }
// Starts the full StyleMD pipeline, responds immediately with runId + status.
// When the pipeline finishes the showcase HTML is saved to runs/<slug>/.
// ---------------------------------------------------------------------------

const postSchema = z.object({
  url: z.string().url(),
  provider: z.enum(["claude", "kimi"]).optional().default("kimi"),
  force: z.boolean().optional().default(false),
});

export async function createScrapedData(req: Request, res: Response): Promise<void> {
  req.socket.setTimeout(0);
  res.setTimeout(0);

  try {
    const { url } = req.body as { url?: string };
    if (!url || typeof url !== "string") {
      res.status(400).json({ ok: false, error: "Invalid or missing URL" });
      return;
    }

    const { provider, force } = postSchema.parse(req.body);
    const urlNormalized = canonicalPageUrl(url);
    console.log(`[SCRAPE] start url=${urlNormalized}`);

    // ── Cache check ────────────────────────────────────────────────────────
    if (!force) {
      const variants = pageUrlVariantsForLookup(urlNormalized);
      const existing = await ScrapedData.findOne({ url: { $in: variants } }).lean<{
        url: string;
        retryCount?: number;
        images: string[];
        contentText: string;
        rawHtml: string;
        previewHtml?: string;
        runServeUrl?: string;
        runId?: string;
        status?: string;
      } | null>();

      if (existing && isValidScrapedRecord(existing)) {
        console.log(`[SCRAPE] db-hit (valid) url=${urlNormalized}`);
        if (existing.previewHtml) {
          res.set("Content-Type", "text/html; charset=utf-8").send(existing.previewHtml);
          return;
        }
      }

      // Already running — don't start a second pipeline
      if (existing?.status === "running") {
        res.status(409).json({
          ok: false,
          error: "A run is already in progress for this URL.",
          runId: existing.runId,
        });
        return;
      }
    }

    // ── Generate a runId and mark as running ───────────────────────────────
    const runIdValue = `stylemd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    await safeWrite(() =>
      ScrapedData.updateOne(
        { url: urlNormalized },
        {
          $set: { url: urlNormalized, runId: runIdValue, status: "running", updatedAt: new Date() },
          $setOnInsert: { createdAt: new Date() },
        },
        { upsert: true }
      )
    );

    // Respond immediately — pipeline runs in background
    res.json({ ok: true, runId: runIdValue, status: "running", url: urlNormalized });

    // ── Run the full pipeline in background ────────────────────────────────
    void (async () => {
      try {
        const result = await runSimplifiedStyleMdPipeline(urlNormalized, provider, runIdValue);

        const runDir = getStyleMdRunDir(result.runId);
        let previewHtml: string | null = null;
        let designMd: string | null = null;
        let runServeUrl: string | null = null;
        let designMdUrl: string | null = null;

        // Render design system HTML + Markdown from semantic_analysis.json (Stage 2 output,
        // always available regardless of whether Kimi stages 4-5 succeeded).
        try {
          const rendered = await renderFromRunDir(runDir, urlNormalized);
          if (rendered) {
            previewHtml = rendered.html;
            designMd = rendered.md;
            const savedHtml = await saveRunHtml(urlNormalized, rendered.html);
            runServeUrl = savedHtml.serveUrl;
            const savedMd = await saveRunDesignMd(urlNormalized, rendered.md);
            designMdUrl = savedMd.serveUrl;
            console.log(`[SCRAPE] saved design system HTML → ${savedHtml.filePath}`);
            console.log(`[SCRAPE] saved design.md → ${savedMd.filePath}`);
          } else {
            console.warn(`[SCRAPE] design system renderer returned null for runDir=${runDir}`);
          }
        } catch (e) {
          console.warn(`[SCRAPE] design system renderer error:`, e instanceof Error ? e.message : String(e));
        }

        await safeWrite(() =>
          ScrapedData.updateOne(
            { url: urlNormalized },
            {
              $set: {
                status: "completed",
                runId: result.runId,
                previewHtml,
                designMd,
                runServeUrl,
                designMdUrl,
                updatedAt: new Date(),
              },
            }
          )
        );

        console.log(`[SCRAPE] pipeline complete url=${urlNormalized} runId=${result.runId}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[SCRAPE] pipeline error url=${urlNormalized}:`, message);
        await safeWrite(() =>
          ScrapedData.updateOne(
            { url: urlNormalized },
            { $set: { status: "failed", error: message, updatedAt: new Date() } }
          )
        ).catch(() => undefined);
      }
    })();
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

    const data = await ScrapedData.find({}, { rawHtml: 0, previewHtml: 0, designMd: 0 }).sort({ createdAt: -1 }).limit(100).lean();
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}
