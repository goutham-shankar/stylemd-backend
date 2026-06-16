"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createScrapedData = createScrapedData;
exports.listScrapedData = listScrapedData;
const zod_1 = require("zod");
const ScrapedData_1 = require("../models/ScrapedData");
const mongodb_1 = require("../../../lib/mongodb");
const pageUrlCanonical_1 = require("../../../lib/services/pageUrlCanonical");
const scrapeQueue_1 = require("../../../lib/queue/scrapeQueue");
const runStorage_1 = require("../services/runStorage");
const r2_1 = require("../../../lib/queue/r2");
// ---------------------------------------------------------------------------
// POST /api/scraped-data  { url }
//
// Cache hit: 302-redirect to the public R2 preview URL (storage v2 — the HTML
// no longer lives in Mongo). Cache miss: enqueue a scrape job in BullMQ and
// return 202 with jobId.
// ---------------------------------------------------------------------------
const postSchema = zod_1.z.object({
    url: zod_1.z.string().url(),
    provider: zod_1.z.enum(["claude", "kimi"]).optional().default("kimi"),
    force: zod_1.z.boolean().optional().default(false),
    /**
     * Storage v2.1: when true, the worker also uploads raw.html to
     * `websites/{slug}/debug/raw.html`. Off by default.
     */
    debugMode: zod_1.z.boolean().optional().default(false),
});
const MAX_WAITING = parseInt(process.env.QUEUE_MAX_WAITING || "500", 10);
async function createScrapedData(req, res) {
    try {
        const { url } = req.body;
        if (!url || typeof url !== "string") {
            res.status(400).json({ ok: false, error: "Invalid or missing URL" });
            return;
        }
        const parsed = postSchema.parse(req.body);
        const provider = parsed.provider;
        const force = parsed.force;
        const debugMode = parsed.debugMode;
        const urlNormalized = (0, pageUrlCanonical_1.canonicalPageUrl)(url);
        const tag = `[SCRAPE ${urlNormalized}]`;
        const t0 = Date.now();
        const elapsed = () => `+${Date.now() - t0}ms`;
        console.log(`${tag} request received force=${force}`);
        // ── Cache check — redirect to R2 if completed ────────────────────────
        if (!force) {
            const variants = (0, pageUrlCanonical_1.pageUrlVariantsForLookup)(urlNormalized);
            const existing = await ScrapedData_1.ScrapedData.findOne({ url: { $in: variants } }).lean();
            if (existing?.status === "completed" && existing.r2?.previewHtml) {
                const publicUrl = (0, r2_1.r2PublicUrl)(existing.r2.previewHtml);
                if (publicUrl) {
                    console.log(`${tag} ✅ cache HIT — redirecting to ${publicUrl} ${elapsed()}`);
                    res.redirect(302, publicUrl);
                    return;
                }
            }
            console.log(`${tag} cache MISS (existing=${!!existing}, status=${existing?.status}) ${elapsed()}`);
        }
        // ── Backpressure ───────────────────────────────────────────────────────
        const waiting = await scrapeQueue_1.scrapeQueue.getWaitingCount();
        if (waiting > MAX_WAITING) {
            console.warn(`${tag} ❌ queue full waiting=${waiting}`);
            res.status(429).json({ ok: false, error: "Queue is full. Please retry shortly.", waiting });
            return;
        }
        // ── Enqueue ────────────────────────────────────────────────────────────
        // BullMQ rejects ':' in custom job IDs — use '-' as the separator.
        const jobId = `scrape-${(0, runStorage_1.urlToSlug)(urlNormalized)}`;
        const existingJob = await scrapeQueue_1.scrapeQueue.getJob(jobId);
        if (existingJob && !force) {
            const state = await existingJob.getState();
            if (state === "waiting" || state === "active" || state === "delayed") {
                console.log(`${tag} ⏳ job already ${state} jobId=${jobId} — returning 202 ${elapsed()}`);
                res.status(202).json({
                    ok: true,
                    jobId,
                    status: state,
                    url: urlNormalized,
                    message: "Job already in progress for this URL.",
                });
                return;
            }
        }
        if (existingJob && force) {
            console.log(`${tag} force=true → removing prior job ${jobId}`);
            await existingJob.remove().catch(() => undefined);
        }
        await scrapeQueue_1.scrapeQueue.add("scrape", { url: urlNormalized, provider, debugMode }, { jobId });
        await (0, mongodb_1.safeWrite)(() => ScrapedData_1.ScrapedData.updateOne({ url: urlNormalized }, {
            $set: { url: urlNormalized, runId: jobId, status: "queued", updatedAt: new Date() },
            $setOnInsert: { createdAt: new Date() },
        }, { upsert: true }));
        console.log(`${tag} 🚀 enqueued jobId=${jobId} ${elapsed()}`);
        res.status(202).json({ ok: true, jobId, status: "queued", url: urlNormalized });
    }
    catch (err) {
        const status = err instanceof zod_1.z.ZodError ? 400 : 500;
        res.status(status).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
}
/**
 * GET /api/scraped-data?url=...   → returns single doc with R2 URLs resolved.
 * GET /api/scraped-data           → returns last 100 docs (metadata only).
 */
async function listScrapedData(req, res) {
    try {
        const { url } = req.query;
        if (url) {
            const variants = (0, pageUrlCanonical_1.pageUrlVariantsForLookup)((0, pageUrlCanonical_1.canonicalPageUrl)(url));
            const doc = await ScrapedData_1.ScrapedData.findOne({ url: { $in: variants } }).lean();
            res.json({ ok: true, data: doc ? withR2Urls(doc) : null });
            return;
        }
        const docs = await ScrapedData_1.ScrapedData.find({}).sort({ updatedAt: -1 }).limit(100).lean();
        res.json({ ok: true, data: docs.map(withR2Urls) });
    }
    catch (err) {
        res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
}
/** Attach resolved public R2 URLs without mutating the stored keys. */
function withR2Urls(doc) {
    const r2 = doc.r2 ?? {};
    return {
        ...doc,
        r2Urls: {
            previewHtml: (0, r2_1.r2PublicUrl)(r2.previewHtml),
            designMd: (0, r2_1.r2PublicUrl)(r2.designMd),
            screenshot: (0, r2_1.r2PublicUrl)(r2.screenshot),
        },
    };
}
