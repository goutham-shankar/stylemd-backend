import type { Request, Response } from "express";
import { z } from "zod";
import { readFile } from "fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { validateStyleMdProviderCredentials } from "@/lib/stylemd-artifacts/provider";
import { runSimplifiedStyleMdPipeline } from "@/lib/stylemd-artifacts/simplifiedPipeline";
import { connectDB, safeWrite } from "@/lib/mongodb";
import {
  slugFromUrl,
} from "@/lib/services/persistStyleMdMongo";
import { pageUrlVariantsForLookup, canonicalPageUrl } from "@/lib/services/pageUrlCanonical";
import { resolveStyleMdForRunDoc } from "@/lib/services/resolveStyleMdFromStores";
import { getStyleMdRunsBaseDir } from "@/lib/stylemd-artifacts/artifacts";
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
    const { url, provider } = requestSchema.parse(req.body);
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

    console.log(`[STYLEMD] Checking cache for slug=${slug}. Found: ${existing ? "YES" : "NO"}, Valid: ${isValid ? "YES" : "NO"}`);

    if (isValid) {
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

    if (existing && !isValid && existing.status !== "running") {
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

    // --- Run the pipeline ---
    // The pipeline now handles its own persistence into MongoDB.
    const result = await runSimplifiedStyleMdPipeline(canonUrl, provider);

    // Reset retry count on success (keyed by runId)
    await safeWrite(() => StyleMdRun.updateOne({ runId: result.runId }, { $set: { retryCount: 0 } }));
    
    const now = new Date();

    const responseData = {
      url: canonUrl,
      slug,
      runId: result.runId,
      provider,
      model: result.model,
      styleMd: result.styleMd,
      images: result.screenshot ? [result.screenshot] : [],
      status: "completed",
      createdAt: now.toISOString(),
    };

    runIdLog(result.runId, `[DEBUG] Sending API response. Payload keys: ${Object.keys(responseData).join(", ")}. styleMdLength=${responseData.styleMd?.length ?? 0}`);
    
    res.json({
      ok: true,
      data: responseData,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[runStyleMd] error:", message);
    if (!res.headersSent) {
      const status = err instanceof z.ZodError ? 400 : 500;
      res.status(status).json({ ok: false, error: message });
    }
  }
}

/** GET /api/stylemd/by-slug/:slug */
export async function getBySlug(req: Request, res: Response): Promise<void> {
  try {
    const { slug } = req.params as { slug: string };

    // 🔴 FETCH LATEST RUN BY SLUG (or specific runId)
    // We check:
    // 1. Exact slug match
    // 2. Exact runId match
    // 3. Normalized slug match (in case frontend passes full hostname)
    const normalizedSlug = slugFromUrl(slug.includes(".") ? `https://${slug}` : slug);
    
    const doc = await StyleMdRun.findOne({
      $or: [
        { slug }, 
        { runId: slug },
        { slug: normalizedSlug }
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
      res.json({
        ok: true,
        status: "processing",
        stage: "running",
        pending: true
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
      .select("url slug runId provider model status createdAt title screenshot")
      .lean<StyleMdRunDoc[]>();

    res.json({
      ok: true,
      data: runs.map((r) => ({
        id: r.runId ?? r.slug ?? r.url,
        url: r.url,
        slug: r.slug,
        title: (r as any).title,
        screenshot: (r as any).screenshot,
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
    if (!filePath || typeof filePath !== "string") {
      res.status(400).json({ ok: false, error: "Missing path" });
      return;
    }

    const runsBaseDir = getStyleMdRunsBaseDir();
    const resolvedPath = isAbsolute(filePath) ? resolve(filePath) : resolve(runsBaseDir, filePath);
    const rel = relative(runsBaseDir, resolvedPath);
    if (rel.startsWith("..")) {
      res.status(400).json({ ok: false, error: "Invalid path." });
      return;
    }

    const buffer = await readFile(resolvedPath);
    const base64 = buffer.toString("base64");
    const ext = resolvedPath.toLowerCase().endsWith(".png") ? "png" : "jpeg";
    const mimeType = ext === "png" ? "image/png" : "image/jpeg";

    res.json({ ok: true, data: `data:${mimeType};base64,${base64}` });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message: String(err) });
  }
}
