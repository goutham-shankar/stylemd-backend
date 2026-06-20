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
import { resolveDesign } from "@/lib/resolvers";
import { urlToSlug } from "./services/runStorage";
import { canonicalPageUrl } from "@/lib/services/pageUrlCanonical";
import { ScrapedData } from "./models/ScrapedData";
import { StyleMdRun } from "./models/StyleMdRun";
import { User } from "./models/User";
import { sendScrapeCompleteEmail } from "./services/email";

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

      // ── Resolve design via Library → Volt → Scrape waterfall ─────────────
      const resolved = await resolveDesign({
        url,
        slug,
        jobId: job.id!,
        provider,
        userId: job.data.userId,
        debugMode,
      }).catch((err) => {
        throw new UnrecoverableError(err instanceof Error ? err.message : String(err));
      });
      await job.updateProgress(100);
      const durationMs = Date.now() - t0;
      console.log(
        `[worker] job=${job.id} done in ${durationMs}ms runId=${resolved.runId} source=${resolved.source}`,
      );

      // Associate userId with the run and send scrape-complete email
      // (scrapeResolver already does this via finalizeStyleMdRun, but
      // volt/library resolvers don't — handle it here for all paths)
      const userId = job.data.userId;
      if (userId && resolved.source !== "scrape") {
        safeWrite(() =>
          StyleMdRun.updateOne(
            { runId: resolved.runId },
            { $addToSet: { userIds: userId } },
          ),
        ).catch(() => undefined);

        User.findOne({ uid: userId }).lean().then((user) => {
          if (!user?.email) return;
          const hostname = (() => {
            try { return new URL(url).hostname; } catch { return slug; }
          })();
          console.log(`[worker] sending scrape-complete email to ${user.email} for ${hostname} (source=${resolved.source})`);
          sendScrapeCompleteEmail(user.email, {
            hostname,
            slug,
            screenshotUrl: resolved.r2?.screenshot ?? null,
            durationMs,
          }).then(() => {
            console.log(`[worker] scrape-complete email sent to ${user.email}`);
          }).catch((e) => {
            console.error(`[worker] scrape-complete email failed:`, e instanceof Error ? e.message : e);
          });
        }).catch(() => undefined);
      }

      return { runId: resolved.runId, r2: resolved.r2 };
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
