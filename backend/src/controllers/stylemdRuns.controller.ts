import type { Request, Response } from "express";
import { z } from "zod";
import { validateStyleMdProviderCredentials } from "@/lib/stylemd-artifacts/provider";
import { getActiveStyleMdRunId, startStyleMdRun, cancelActiveStyleMdRun, getStyleMdRunSummary, listStyleMdRunSummaries } from "@/lib/stylemd-artifacts/runManager";

const startRunSchema = z.object({
  url: z.string().url(),
  provider: z.enum(["claude", "kimi"]).optional().default("kimi"),
});

export async function startRun(req: Request, res: Response): Promise<void> {
  try {
    const { url, provider } = startRunSchema.parse(req.body);
    const credentialError = validateStyleMdProviderCredentials(provider);
    if (credentialError) {
      res.status(400).json({ ok: false, error: credentialError });
      return;
    }
    const activeRunId = getActiveStyleMdRunId();
    if (activeRunId) {
      res.status(409).json({ ok: false, error: `Run active: ${activeRunId}` });
      return;
    }
    const { runId } = await startStyleMdRun(url, provider);
    res.json({ ok: true, runId });
  } catch (err) {
    res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

export async function cancelRun(_req: Request, res: Response): Promise<void> {
  try {
    const result = await cancelActiveStyleMdRun();
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

export async function getRunSummary(req: Request, res: Response): Promise<void> {
  try {
    const summary = await getStyleMdRunSummary(req.params.runId);
    if (!summary) {
      res.status(404).json({ ok: false, error: "Run not found." });
      return;
    }
    res.json({ ok: true, summary });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

export async function listRuns(_req: Request, res: Response): Promise<void> {
  try {
    const summaries = await listStyleMdRunSummaries();
    res.json({ ok: true, summaries });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}
