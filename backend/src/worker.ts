/**
 * BullMQ worker process.
 * Runs the StyleMD pipeline (Playwright + Kimi + render) and uploads artifacts to R2.
 * Started as a separate PM2 app — keeps Chromium/OOM blast radius away from the HTTP API.
 */
import "dotenv/config";
import mongoose from "mongoose";
import { Worker, UnrecoverableError } from "bullmq";
import { connection } from "@/lib/queue/redis";
import { SCRAPE_QUEUE, type ScrapeJobData, type ScrapeJobResult } from "@/lib/queue/types";
import { uploadR2 } from "@/lib/queue/r2";
import { connectDB, safeWrite } from "@/lib/mongodb";
import { runSimplifiedStyleMdPipeline } from "@/lib/stylemd-artifacts/simplifiedPipeline";
import { getStyleMdRunDir } from "@/lib/stylemd-artifacts/artifacts";
import { renderFromRunDir } from "./services/designSystemRenderer";
import { urlToSlug } from "./services/runStorage";
import { canonicalPageUrl } from "@/lib/services/pageUrlCanonical";
import { ScrapedData } from "./models/ScrapedData";

const CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || "2", 10);
const LOCK_DURATION = parseInt(process.env.WORKER_LOCK_MS || "300000", 10); // 5 min — long enough for slow scrapes

function dataUrlToBuffer(dataUrl: string): { buffer: Buffer; contentType: string } | null {
  const m = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl);
  if (!m) return null;
  return { contentType: m[1], buffer: Buffer.from(m[2], "base64") };
}

async function start(): Promise<void> {
  console.log("---------------------------------------------------------------------------");
  console.log(`[worker] BUILD_ID: ${Date.now()}`);
  console.log(`[worker] starting StyleMD worker — concurrency=${CONCURRENCY}`);
  console.log("---------------------------------------------------------------------------");

  await connectDB();

  const worker = new Worker<ScrapeJobData, ScrapeJobResult>(
    SCRAPE_QUEUE,
    async (job) => {
      const url = canonicalPageUrl(job.data.url);
      const provider = job.data.provider || "kimi";

      console.log(`[worker] job ${job.id} start url=${url} provider=${provider}`);
      await job.updateProgress(5);

      // Run the full StyleMD pipeline.
      const result = await runSimplifiedStyleMdPipeline(url, provider, job.id!);
      await job.updateProgress(70);

      // Render preview.html + design.md from the pipeline's run directory.
      const runDir = getStyleMdRunDir(result.runId);
      const rendered = await renderFromRunDir(runDir, url);
      if (!rendered) {
        throw new UnrecoverableError(`render produced no output for runDir=${runDir}`);
      }
      await job.updateProgress(85);

      // Upload artifacts to R2 — keyed by URL slug (e.g. "fit-green-mind.com_index/preview.html")
      // so the path is human-readable. Each new run for the same URL overwrites the previous one.
      const keyBase = urlToSlug(url);
      const previewHtmlUrl = await uploadR2(`${keyBase}/preview.html`, rendered.html, "text/html; charset=utf-8");
      const designMdUrl = await uploadR2(`${keyBase}/design.md`, rendered.md, "text/markdown; charset=utf-8");

      let screenshotUrl: string | undefined;
      const shot = result.screenshot ? dataUrlToBuffer(result.screenshot) : null;
      if (shot) {
        screenshotUrl = await uploadR2(`${keyBase}/screenshot.jpg`, shot.buffer, shot.contentType);
      }
      await job.updateProgress(95);

      // Mirror final state to Mongo.
      await safeWrite(() =>
        ScrapedData.updateOne(
          { url },
          {
            $set: {
              status: "completed",
              runId: result.runId,
              previewHtml: rendered.html,
              designMd: rendered.md,
              runServeUrl: previewHtmlUrl,
              designMdUrl: designMdUrl,
              screenshotUrl,
              updatedAt: new Date(),
            },
          },
          { upsert: true },
        ),
      );
      await job.updateProgress(100);

      console.log(`[worker] job ${job.id} done runId=${result.runId}`);
      return {
        runId: result.runId,
        r2: { previewHtml: previewHtmlUrl, designMd: designMdUrl, screenshot: screenshotUrl },
      };
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
    // Mirror failure to Mongo on the final attempt.
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
