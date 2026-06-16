/**
 * BullMQ worker — runs the StyleMD pipeline, uploads to R2, mirrors metadata
 * to Mongo, then deletes the local .playground/<runId>/ scratch dir.
 *
 * Runs as a separate PM2 app so Playwright/Chromium OOMs can't take down the
 * HTTP API process.
 */
import "dotenv/config";
import mongoose from "mongoose";
import { Worker, UnrecoverableError } from "bullmq";

import { connection } from "@/lib/queue/redis";
import { SCRAPE_QUEUE, type ScrapeJobData, type ScrapeJobResult } from "@/lib/queue/types";
import { PIPELINE_VERSION, STORAGE_VERSION } from "@/lib/queue/r2";
import { connectDB, safeWrite } from "@/lib/mongodb";
import { runSimplifiedStyleMdPipeline } from "@/lib/stylemd-artifacts/simplifiedPipeline";
import { finalizeStyleMdRun } from "./services/finalizeStyleMdRun";
import { urlToSlug } from "./services/runStorage";
import { canonicalPageUrl } from "@/lib/services/pageUrlCanonical";
import { ScrapedData } from "./models/ScrapedData";

const CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || "2", 10);
const LOCK_DURATION = parseInt(process.env.WORKER_LOCK_MS || "300000", 10); // 5 min

async function start(): Promise<void> {
  console.log("---------------------------------------------------------------------------");
  console.log(`[worker] BUILD_ID: ${Date.now()}`);
  console.log(`[worker] Design Probe worker — concurrency=${CONCURRENCY}  storage=${STORAGE_VERSION}  pipeline=${PIPELINE_VERSION}`);
  console.log("---------------------------------------------------------------------------");

  await connectDB();

  const worker = new Worker<ScrapeJobData, ScrapeJobResult>(
    SCRAPE_QUEUE,
    async (job) => {
      const url = canonicalPageUrl(job.data.url);
      const provider = job.data.provider || "kimi";
      const debugMode = job.data.debugMode === true;
      const slug = urlToSlug(url);
      const t0 = Date.now();

      console.log(
        `[worker] job=${job.id} start url=${url} slug=${slug} provider=${provider}` +
          (debugMode ? " debugMode=true" : ""),
      );
      await job.updateProgress(5);

      // ── 1. Run pipeline → artifacts land in .playground/<runId>/ ──────────
      const result = await runSimplifiedStyleMdPipeline(url, provider, job.id!);
      await job.updateProgress(70);

      // ── 2. Render + upload to R2 + patch Mongo + clean scratch dir ────────
      const durationMs = Date.now() - t0;
      const r2Doc = await finalizeStyleMdRun({
        runId: result.runId,
        url,
        durationMs,
        screenshotDataUrl: result.screenshot,
        debugMode,
      }).catch((err) => {
        throw new UnrecoverableError(err instanceof Error ? err.message : String(err));
      });
      await job.updateProgress(100);
      console.log(`[worker] job=${job.id} done in ${durationMs}ms runId=${result.runId}`);

      return { runId: result.runId, r2: r2Doc };
    },
    {
      connection,
      concurrency: CONCURRENCY,
      lockDuration: LOCK_DURATION,
      limiter: { max: 50, duration: 1000 },
    },
  );

  worker.on("active", (job) => console.log(`[worker] active   ${job.id}`));
  worker.on("completed", (job) => console.log(`[worker] complete ${job.id}`));
  worker.on("failed", (job, err) => {
    console.error(`[worker] failed   ${job?.id} attempts=${job?.attemptsMade} err=${err.message}`);
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      const url = canonicalPageUrl(job.data.url);
      safeWrite(() =>
        ScrapedData.updateOne(
          { url },
          { $set: { status: "failed", error: err.message, updatedAt: new Date() } },
        ),
      ).catch((e) => console.error("[worker] failure-mirror error:", e));
    }
  });
  worker.on("stalled", (jobId) => console.warn(`[worker] stalled  ${jobId}`));
  worker.on("error", (err) => console.error("[worker] error:", err.message));

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[worker] received ${signal}, draining…`);
    await worker.close();
    await mongoose.disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

start().catch((err) => {
  console.error("[worker] fatal error", err);
  process.exit(1);
});
