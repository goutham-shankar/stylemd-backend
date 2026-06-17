"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * BullMQ worker — runs the StyleMD pipeline, uploads to R2, mirrors metadata
 * to Mongo, then deletes the local .playground/<runId>/ scratch dir.
 *
 * Runs as a separate PM2 app so Playwright/Chromium OOMs can't take down the
 * HTTP API process.
 */
require("dotenv/config");
const mongoose_1 = __importDefault(require("mongoose"));
const bullmq_1 = require("bullmq");
const redis_1 = require("../../lib/queue/redis");
const types_1 = require("../../lib/queue/types");
const r2_1 = require("../../lib/queue/r2");
const mongodb_1 = require("../../lib/mongodb");
const simplifiedPipeline_1 = require("../../lib/stylemd-artifacts/simplifiedPipeline");
const finalizeStyleMdRun_1 = require("./services/finalizeStyleMdRun");
const runStorage_1 = require("./services/runStorage");
const pageUrlCanonical_1 = require("../../lib/services/pageUrlCanonical");
const ScrapedData_1 = require("./models/ScrapedData");
const CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || "2", 10);
const LOCK_DURATION = parseInt(process.env.WORKER_LOCK_MS || "300000", 10); // 5 min
async function start() {
    console.log("---------------------------------------------------------------------------");
    console.log(`[worker] BUILD_ID: ${Date.now()}`);
    console.log(`[worker] Design Probe worker — concurrency=${CONCURRENCY}  storage=${r2_1.STORAGE_VERSION}  pipeline=${r2_1.PIPELINE_VERSION}`);
    console.log("---------------------------------------------------------------------------");
    await (0, mongodb_1.connectDB)();
    const worker = new bullmq_1.Worker(types_1.SCRAPE_QUEUE, async (job) => {
        const url = (0, pageUrlCanonical_1.canonicalPageUrl)(job.data.url);
        const provider = job.data.provider || "kimi";
        const debugMode = job.data.debugMode === true;
        const slug = (0, runStorage_1.urlToSlug)(url);
        const t0 = Date.now();
        console.log(`[worker] job=${job.id} start url=${url} slug=${slug} provider=${provider}` +
            (debugMode ? " debugMode=true" : ""));
        await job.updateProgress(5);
        // ── 1. Run pipeline → artifacts land in .playground/<runId>/ ──────────
        const result = await (0, simplifiedPipeline_1.runSimplifiedStyleMdPipeline)(url, provider, job.id);
        await job.updateProgress(70);
        // ── 2. Render + upload to R2 + patch Mongo + clean scratch dir ────────
        const durationMs = Date.now() - t0;
        const r2Doc = await (0, finalizeStyleMdRun_1.finalizeStyleMdRun)({
            runId: result.runId,
            url,
            durationMs,
            screenshotDataUrl: result.screenshot,
            debugMode,
            userId: job.data.userId,
        }).catch((err) => {
            throw new bullmq_1.UnrecoverableError(err instanceof Error ? err.message : String(err));
        });
        await job.updateProgress(100);
        console.log(`[worker] job=${job.id} done in ${durationMs}ms runId=${result.runId}`);
        return { runId: result.runId, r2: r2Doc };
    }, {
        connection: redis_1.connection,
        concurrency: CONCURRENCY,
        lockDuration: LOCK_DURATION,
        limiter: { max: 50, duration: 1000 },
    });
    worker.on("active", (job) => console.log(`[worker] active   ${job.id}`));
    worker.on("completed", (job) => console.log(`[worker] complete ${job.id}`));
    worker.on("failed", (job, err) => {
        console.error(`[worker] failed   ${job?.id} attempts=${job?.attemptsMade} err=${err.message}`);
        if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
            const url = (0, pageUrlCanonical_1.canonicalPageUrl)(job.data.url);
            (0, mongodb_1.safeWrite)(() => ScrapedData_1.ScrapedData.updateOne({ url }, { $set: { status: "failed", error: err.message, updatedAt: new Date() } })).catch((e) => console.error("[worker] failure-mirror error:", e));
        }
    });
    worker.on("stalled", (jobId) => console.warn(`[worker] stalled  ${jobId}`));
    worker.on("error", (err) => console.error("[worker] error:", err.message));
    const shutdown = async (signal) => {
        console.log(`[worker] received ${signal}, draining…`);
        await worker.close();
        await mongoose_1.default.disconnect();
        process.exit(0);
    };
    process.on("SIGTERM", () => void shutdown("SIGTERM"));
    process.on("SIGINT", () => void shutdown("SIGINT"));
}
start().catch((err) => {
    console.error("[worker] fatal error", err);
    process.exit(1);
});
