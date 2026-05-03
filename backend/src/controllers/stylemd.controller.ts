import type { Request, Response } from "express";
import { z } from "zod";
import { validateStyleMdProviderCredentials } from "@/lib/stylemd-artifacts/provider";
import { runSimplifiedStyleMdPipeline } from "@/lib/stylemd-artifacts/simplifiedPipeline";
import { connectMongo } from "@/lib/mongodb";
import {
  ensureUniqueSlug,
  persistStyleMdAfterGeneration,
  slugFromUrl,
} from "@/lib/services/persistStyleMdMongo";
import { StyleMdRun } from "../models/StyleMdRun";

interface StyleMdRunDoc {
  url: string;
  slug?: string;
  runId?: string;
  provider?: string;
  model?: string;
  styleMd?: string;
  screenshotUrl?: string;
  screenshot?: string;
  status?: string;
  createdAt?: Date;
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

    // --- Cache hit (skip in-flight artifact runs and empty placeholders) ---
    const existing = await StyleMdRun.findOne({ url }).lean<StyleMdRunDoc>();
    if (existing && existing.status !== "running" && existing.styleMd?.trim()) {
      res.json({
        ok: true,
        data: {
          url: existing.url,
          slug: existing.slug ?? slugFromUrl(existing.url),
          runId: existing.runId,
          styleMd: existing.styleMd,
          screenshotUrl: existing.screenshotUrl,
          screenshot: existing.screenshot ?? "",
          provider: existing.provider,
          model: existing.model,
          status: existing.status,
          createdAt: (existing.createdAt as Date)?.toISOString?.() ?? String(existing.createdAt),
        },
        cached: true,
      });
      return;
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
    const result = await runSimplifiedStyleMdPipeline(url, provider);

    const slugBase = await ensureUniqueSlug(slugFromUrl(url));
    const persisted = await persistStyleMdAfterGeneration({
      url,
      runId: result.runId,
      provider,
      model: result.model,
      styleMd: result.styleMd,
      screenshotUrl: result.screenshotUrl,
      screenshot: result.screenshot,
      slug: slugBase,
      runStatus: result.styleMd?.trim() ? "completed" : "completed_with_warnings",
    });
    const slug = persisted?.slug ?? slugBase;
    const now = new Date();

    res.json({
      ok: true,
      data: {
        url,
        slug,
        runId: result.runId,
        provider,
        model: result.model,
        styleMd: result.styleMd,
        screenshotUrl: result.screenshotUrl,
        screenshot: result.screenshot,
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

/** GET /api/stylemd/by-slug/:slug — retrieve a cached run by its human-readable slug or runId */
export async function getBySlug(req: Request, res: Response): Promise<void> {
  try {
    const { slug } = req.params as { slug: string };
    await connectMongo();

    // Look up by slug first, then fall back to runId for backwards compat
    // This supports: human-readable slugs (youtube), URL-safe slugs (youtube-2), and runIds (stylemd_1234567)
    const doc = await StyleMdRun.findOne({
      $or: [{ slug }, { runId: slug }],
    }).lean<StyleMdRunDoc>();

    if (!doc) {
      console.warn(`[getBySlug] No run found for slug/runId: ${slug}`);
      res.status(404).json({ ok: false, error: `No run found for slug: ${slug}` });
      return;
    }

    console.log(`[getBySlug] Found run for slug/runId: ${slug}, runId: ${doc.runId}`);
    res.json({
      ok: true,
      data: {
        url: doc.url,
        slug: doc.slug ?? slugFromUrl(doc.url),
        runId: doc.runId,
        styleMd: doc.styleMd ?? "",
        screenshotUrl: doc.screenshotUrl ?? "",
        screenshot: doc.screenshot ?? "",
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

interface StyleMdRunSummary {
  url: string;
  slug?: string;
  runId?: string;
  provider?: string;
  model?: string;
  status?: string;
  createdAt?: Date;
}

/** GET /api/stylemd/runs — list all completed StyleMD runs for the library */
export async function listStyleMdRuns(req: Request, res: Response): Promise<void> {
  try {
    await connectMongo();
    const runs = await StyleMdRun.find({})
      .sort({ createdAt: -1 })
      .select("url slug runId provider model status createdAt")
      .lean<StyleMdRunSummary[]>();

    res.json({
      ok: true,
      summaries: runs.map((r) => ({
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
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}
