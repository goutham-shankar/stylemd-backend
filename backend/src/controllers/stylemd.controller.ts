import type { Request, Response } from "express";
import { z } from "zod";
import { readFile } from "fs/promises";
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

import { isValidScrapedRecord } from "../utils/validation";
import { runIdLog } from "@/lib/stylemd-artifacts/helpers";

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
  force: z.boolean().optional().default(false),
});

export async function clearCache(_req: Request, res: Response): Promise<void> {
  try {
    await safeWrite(() => StyleMdRun.deleteMany({}));
    res.json({ ok: true, data: { message: "Cache cleared" } });
  } catch (err) {
    res
      .status(500)
      .json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

export async function runStyleMd(req: Request, res: Response): Promise<void> {
  req.socket.setTimeout(0);
  res.setTimeout(0);

  try {
    const { url, provider, force } = requestSchema.parse(req.body);
    const canonUrl = canonicalPageUrl(url);
    const slug = slugFromUrl(canonUrl);

    // --- Cache hit (find LATEST run for this slug) ---
    const existing = await StyleMdRun.findOne({ slug })
      .sort({ createdAt: -1 })
      .lean<StyleMdRunDoc>();
    
    // 🟠 FIX: StyleMdRun does not have contentText/rawHtml, so isValidScrapedRecord fails.
    // We check for status="completed" and non-empty styleMd.
    const isValid = existing && 
      existing.status === "completed" && 
      existing.styleMd?.trim() && 
      existing.images?.length;

    console.log(`[STYLEMD] Checking cache for slug=${slug}. Found: ${existing ? "YES" : "NO"}, Valid: ${isValid ? "YES" : "NO"}, Force: ${force}`);

    if (!force && isValid) {
      console.log(`[STYLEMD] cache-hit (valid) slug=${slug}`);
      res.json({
        ok: true,
        data: {
          url: existing.url,
          slug: existing.slug,
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

    if (!force && existing && !isValid && existing.status !== "running") {
      const retries = existing.retryCount || 0;
      if (retries >= 2) {
        console.warn(`[STYLEMD] max retries reached for ${slug}, returning last known data`);
        res.json({
          ok: true,
          data: {
            url: existing.url,
            slug: existing.slug,
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
      
      console.log(`[STYLEMD] invalid cache detected, re-scraping (attempt ${retries + 1}): ${slug}`);
      await safeWrite(() => StyleMdRun.updateOne({ runId: existing.runId }, { $inc: { retryCount: 1 } }));
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
    void (async () => {
      try {
        const result = await runSimplifiedStyleMdPipeline(canonUrl, provider, runIdValue);
        
        // Reset retry count on success
        await safeWrite(() => StyleMdRun.updateOne({ runId: result.runId }, { $set: { retryCount: 0 } }));
        
        runIdLog(result.runId, `[DEBUG] Pipeline completed successfully. styleMdLength=${result.styleMd?.length ?? 0}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[runStyleMd] Pipeline background error for ${runIdValue}:`, message);
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
          provider: doc.provider,
          model: doc.model,
          status: "processing",
          pending: true,
          createdAt: (doc.createdAt as Date)?.toISOString?.() ?? String(doc.createdAt),
        },
      });
      return;
    }

    const styleMd = await resolveStyleMdForRunDoc(doc);
    if (doc.styleMd) {
      console.log(`[CANONICAL_ARTIFACT_FOUND] Resolved styleMd for ${slug}. Length: ${styleMd.length}.`);
    } else {
      console.log(`[FALLBACK_TRIGGERED] Resolved styleMd for ${slug}. Length: ${styleMd.length}. (Source was fallback: true)`);
    }

    res.json({
      ok: true,
      data: {
        url: doc.url,
        slug: doc.slug,
        runId: doc.runId,
        styleMd,
        designTokens: (doc as any).designTokens ?? null,
        images: doc.images ?? [],
        title: (doc as any).title,
        description: (doc as any).description,
        h1: (doc as any).h1,
        canonical: (doc as any).canonical,
        brandAssets: (doc as any).brandAssets,
        screenshot: (doc as any).screenshot,
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
      .select("url slug runId provider model status createdAt title brandAssets")
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
