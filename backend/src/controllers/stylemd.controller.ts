import type { Request, Response } from "express";
import { z } from "zod";
import { readFile } from "fs/promises";
import { validateStyleMdProviderCredentials } from "@/lib/stylemd-artifacts/provider";
import { runSimplifiedStyleMdPipeline } from "@/lib/stylemd-artifacts/simplifiedPipeline";
import { connectMongo } from "@/lib/mongodb";
import {
  ensureUniqueSlug,
  persistStyleMdAfterGeneration,
  slugFromUrl,
} from "@/lib/services/persistStyleMdMongo";
import { pageUrlVariantsForLookup, canonicalPageUrl } from "@/lib/services/pageUrlCanonical";
import { resolveStyleMdForRunDoc } from "@/lib/services/resolveStyleMdFromStores";
import { StyleMdRun } from "../models/StyleMdRun";
import { ScrapedData } from "../models/ScrapedData";

import { isValidScrapedRecord } from "../utils/validation";

interface StyleMdRunDoc {
  url: string;
  slug?: string;
  runId?: string;
  provider?: string;
  model?: string;
  styleMd?: string;
  images?: string[];
  status?: string;
  createdAt?: Date;
  retryCount?: number;
  contentText?: string;
  rawHtml?: string;
}

const requestSchema = z.object({
  url: z.string().url(),
  provider: z.enum(["claude", "kimi"]).optional().default("kimi"),
});

export async function clearCache(_req: Request, res: Response): Promise<void> {
  try {
    await connectMongo();
    await StyleMdRun.deleteMany({});
    res.json({ ok: true, message: "Cache cleared" });
  } catch (err) {
    res
      .status(500)
      .json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

export async function runStyleMd(req: Request, res: Response): Promise<void> {
  // The pipeline can run for 5–10 minutes. Disable the default socket timeout
  // for this specific request so the connection stays open until completion.
  req.socket.setTimeout(0);
  res.setTimeout(0);

  try {
    const { url, provider } = requestSchema.parse(req.body);
    await connectMongo();

    const canonUrl = canonicalPageUrl(url);
    const urlAliases = pageUrlVariantsForLookup(canonUrl);

    // --- Cache hit (skip in-flight artifact runs and empty placeholders) ---
    const existing = await StyleMdRun.findOne({ url: { $in: urlAliases } }).lean<StyleMdRunDoc>();
    
    // STRICT validity check: return cached only if valid
    const isValid = existing && existing.status !== "running" && existing.styleMd?.trim() && isValidScrapedRecord(existing);

    if (isValid) {
      console.log(`[STYLEMD] cache-hit (valid) url=${canonUrl}`);
      res.json({
        ok: true,
        data: {
          url: existing.url,
          slug: existing.slug ?? slugFromUrl(existing.url),
          runId: existing.runId,
          styleMd: existing.styleMd,
          images: existing.images ?? [],
          provider: existing.provider,
          model: existing.model,
          status: existing.status,
          createdAt: (existing.createdAt as Date)?.toISOString?.() ?? String(existing.createdAt),
        },
        cached: true,
      });
      return;
    }

    // 🔴 FIX 3: PREVENT INFINITE RE-SCRAPE LOOP
    if (existing && !isValid && existing.status !== "running") {
      const retries = existing.retryCount || 0;
      if (retries >= 2) {
        console.warn(`[STYLEMD] max retries reached for ${canonUrl}, returning last known data`);
        res.json({
          ok: true,
          data: {
            url: existing.url,
            slug: existing.slug ?? slugFromUrl(existing.url),
            runId: existing.runId,
            styleMd: existing.styleMd,
            images: existing.images ?? [],
            provider: existing.provider,
            model: existing.model,
            status: existing.status,
            createdAt: (existing.createdAt as Date)?.toISOString?.() ?? String(existing.createdAt),
          },
          cached: true,
        });
        return;
      }
      
      // 🟠 FIX 6: ADD LOGGING FOR OVERWRITE
      console.log(`[STYLEMD] invalid cache detected, re-scraping (attempt ${retries + 1}): ${canonUrl}`);
      
      // Increment retry count before re-scraping
      await StyleMdRun.updateOne({ url: existing.url }, { $inc: { retryCount: 1 } });
    }

    if (existing?.status === "running") {
      res.status(409).json({
        ok: false,
        error: "A StyleMD run is already in progress for this URL. Wait for it to finish or use the artifact pipeline status API.",
      });
      return;
    }

    // --- Credential check ---
    const credentialError = validateStyleMdProviderCredentials(provider);
    if (credentialError) {
      res.status(400).json({ ok: false, error: credentialError });
      return;
    }

    // --- Run the pipeline ---
    const result = await runSimplifiedStyleMdPipeline(canonUrl, provider);

    const slugBase = await ensureUniqueSlug(slugFromUrl(canonUrl));
    const persisted = await persistStyleMdAfterGeneration({
      url: canonUrl,
      runId: result.runId,
      provider,
      model: result.model,
      styleMd: result.styleMd,
      screenshot: result.screenshot,
      slug: slugBase,
      runStatus: result.styleMd?.trim() ? "completed" : "completed_with_warnings",
    });
    
    // Reset retry count on success
    await StyleMdRun.updateOne({ url: canonUrl }, { $set: { retryCount: 0 } });
    
    const slug = persisted?.slug ?? slugBase;
    const now = new Date();

    res.json({
      ok: true,
      data: {
        url: canonUrl,
        slug,
        runId: result.runId,
        provider,
        model: result.model,
        styleMd: result.styleMd,
        images: result.screenshot ? [result.screenshot] : [],
        status: "completed",
        createdAt: now.toISOString(),
      },
    });
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
    await connectMongo();

    const doc = await StyleMdRun.findOne({
      $or: [{ slug }, { runId: slug }],
    }).lean<StyleMdRunDoc>();

    if (!doc) {
      console.warn(`[getBySlug] No run found for slug/runId: ${slug}`);
      res.status(404).json({ ok: false, error: `No run found for slug: ${slug}` });
      return;
    }

    const styleMd = await resolveStyleMdForRunDoc(doc);

    res.json({
      ok: true,
      data: {
        url: doc.url,
        slug: doc.slug ?? slugFromUrl(doc.url),
        runId: doc.runId,
        styleMd,
        images: doc.images ?? [],
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
    await connectMongo();
    const runs = await StyleMdRun.find({})
      .sort({ createdAt: -1 })
      .select("url slug runId provider model status createdAt")
      .lean<StyleMdRunDoc[]>();

    res.json({
      ok: true,
      data: runs.map((r) => ({
        id: r.runId ?? r.slug ?? r.url,
        url: r.url,
        slug: r.slug ?? slugFromUrl(r.url),
        provider: r.provider ?? "kimi",
        model: r.model,
        status: r.status ?? "completed",
        createdAt: (r.createdAt as Date)?.toISOString?.() ?? String(r.createdAt),
      })),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message: String(err) });
  }
}

export async function fetchImageAsBase64(req: Request, res: Response): Promise<void> {
  try {
    const { path: filePath } = req.body as { path: string };
    if (!filePath) {
      res.status(400).json({ ok: false, error: "Missing path" });
      return;
    }

    const buffer = await readFile(filePath);
    const base64 = buffer.toString("base64");
    const ext = filePath.toLowerCase().endsWith(".png") ? "png" : "jpeg";
    const mimeType = ext === "png" ? "image/png" : "image/jpeg";

    res.json({ ok: true, data: `data:${mimeType};base64,${base64}` });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message: String(err) });
  }
}
