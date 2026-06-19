import { runSimplifiedStyleMdPipeline } from "@/lib/stylemd-artifacts/simplifiedPipeline";
import { finalizeStyleMdRun } from "@/backend/src/services/finalizeStyleMdRun";
import type { DesignResolver, ResolverContext, ResolveResult } from "./types";

export const scrapeResolver: DesignResolver = {
  name: "scrape",

  async canResolve(_ctx) {
    return true;
  },

  async resolve(ctx) {
    const t0 = Date.now();
    const result = await runSimplifiedStyleMdPipeline(ctx.url, ctx.provider, ctx.jobId, ctx.userId);
    const durationMs = Date.now() - t0;

    const r2Doc = await finalizeStyleMdRun({
      runId: result.runId,
      url: ctx.url,
      durationMs,
      screenshotDataUrl: result.screenshot,
      debugMode: ctx.debugMode,
      userId: ctx.userId,
      source: "scrape",
    });

    return { runId: result.runId, source: "scrape", r2: r2Doc };
  },
};
