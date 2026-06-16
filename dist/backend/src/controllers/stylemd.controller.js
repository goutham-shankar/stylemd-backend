"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clearCache = clearCache;
exports.runStyleMd = runStyleMd;
exports.getBySlug = getBySlug;
exports.listStyleMdRuns = listStyleMdRuns;
exports.fetchImageAsBase64 = fetchImageAsBase64;
const zod_1 = require("zod");
const promises_1 = require("fs/promises");
const provider_1 = require("../../../lib/stylemd-artifacts/provider");
const simplifiedPipeline_1 = require("../../../lib/stylemd-artifacts/simplifiedPipeline");
const mongodb_1 = require("../../../lib/mongodb");
const persistStyleMdMongo_1 = require("../../../lib/services/persistStyleMdMongo");
const pageUrlCanonical_1 = require("../../../lib/services/pageUrlCanonical");
const resolveStyleMdFromStores_1 = require("../../../lib/services/resolveStyleMdFromStores");
const StyleMdRun_1 = require("../models/StyleMdRun");
const r2_1 = require("../../../lib/queue/r2");
const finalizeStyleMdRun_1 = require("../services/finalizeStyleMdRun");
const helpers_1 = require("../../../lib/stylemd-artifacts/helpers");
/**
 * Build the cache-hit response payload for a completed run. styleMd text lives
 * in R2 (design.md) under storage v2, so we fetch it from there; preview/
 * screenshot are returned as resolved public R2 URLs.
 */
async function buildCachedPayload(existing, r2) {
    const styleMd = (await (0, r2_1.fetchR2Text)(r2?.designMd)) ?? existing.styleMd ?? "";
    return {
        url: existing.url,
        slug: existing.slug,
        runId: existing.runId,
        styleMd,
        images: existing.images ?? [],
        r2Urls: {
            previewHtml: (0, r2_1.r2PublicUrl)(r2?.previewHtml),
            designMd: (0, r2_1.r2PublicUrl)(r2?.designMd),
            screenshot: (0, r2_1.r2PublicUrl)(r2?.screenshot),
        },
        tokenUsage: existing.tokenUsage ?? null,
        costEstimate: existing.costEstimate ?? null,
        provider: existing.provider,
        model: existing.model,
        status: existing.status,
        createdAt: existing.createdAt?.toISOString?.() ?? String(existing.createdAt),
    };
}
const requestSchema = zod_1.z.object({
    url: zod_1.z.string().url(),
    provider: zod_1.z.enum(["claude", "kimi"]).optional().default("kimi"),
    force: zod_1.z.boolean().optional().default(false),
});
async function clearCache(_req, res) {
    try {
        await (0, mongodb_1.safeWrite)(() => StyleMdRun_1.StyleMdRun.deleteMany({}));
        res.json({ ok: true, data: { message: "Cache cleared" } });
    }
    catch (err) {
        res
            .status(500)
            .json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
}
async function runStyleMd(req, res) {
    req.socket.setTimeout(0);
    res.setTimeout(0);
    try {
        const { url, provider, force } = requestSchema.parse(req.body);
        const canonUrl = (0, pageUrlCanonical_1.canonicalPageUrl)(url);
        const slug = (0, persistStyleMdMongo_1.slugFromUrl)(canonUrl);
        // --- Cache hit (find LATEST run for this URL) ---
        // Look up by canonical URL (+ www variants), NOT slug: two slug schemes
        // coexist in the codebase (slugFromUrl strips www/.com, urlToSlug keeps the
        // hostname) and finalize overwrites the doc's slug with the urlToSlug form,
        // so a slug query would miss. `url` is written identically by every path.
        const urlVariants = (0, pageUrlCanonical_1.pageUrlVariantsForLookup)(canonUrl);
        const existing = await StyleMdRun_1.StyleMdRun.findOne({ url: { $in: urlVariants } })
            .sort({ createdAt: -1 })
            .lean();
        // Storage v2: artifacts live in R2, NOT inline on the Mongo doc. A run is a
        // valid cache hit when it completed and produced R2 artifacts (preview/md).
        // The old check looked at existing.styleMd/images — fields v2 never writes —
        // so every lookup was a miss and re-scraped from scratch.
        const r2 = existing?.r2 ?? null;
        const isValid = Boolean(existing &&
            (existing.status === "completed" || existing.status === "completed_with_warnings") &&
            (r2?.previewHtml || r2?.designMd));
        console.log(`[STYLEMD] Checking cache for slug=${slug}. Found: ${existing ? "YES" : "NO"}, Valid: ${isValid ? "YES" : "NO"}, Force: ${force}`);
        if (!force && isValid && existing) {
            console.log(`[STYLEMD] cache-hit (valid) slug=${slug} — returning stored R2 artifacts, no re-scrape`);
            const cachedPayload = await buildCachedPayload(existing, r2);
            res.json({ ok: true, data: cachedPayload, cached: true });
            return;
        }
        if (existing?.status === "running") {
            res.status(409).json({
                ok: false,
                error: "A StyleMD run is already in progress for this website. Wait for it to finish.",
            });
            return;
        }
        // --- Credential check ---
        const credentialError = (0, provider_1.validateStyleMdProviderCredentials)(provider);
        if (credentialError) {
            res.status(400).json({ ok: false, error: credentialError });
            return;
        }
        // --- Run the pipeline in background ---
        // Generate a runId here so we can return it immediately
        const runIdValue = `stylemd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        // 🟢 Create the pending record BEFORE responding, so getBySlug always finds it
        try {
            await (0, mongodb_1.safeWrite)(() => StyleMdRun_1.StyleMdRun.updateOne({ runId: runIdValue }, {
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
            }, { upsert: true }));
        }
        catch (pendingErr) {
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
        const startedAt = Date.now();
        void (async () => {
            try {
                const result = await (0, simplifiedPipeline_1.runSimplifiedStyleMdPipeline)(canonUrl, provider, runIdValue);
                // Finalize: render → upload artifacts to R2 → patch the run doc with R2
                // keys → clean scratch dir. Without this, /api/stylemd runs never get
                // R2 keys persisted, so they're neither retrievable nor cache-hittable.
                await (0, finalizeStyleMdRun_1.finalizeStyleMdRun)({
                    runId: result.runId,
                    url: canonUrl,
                    durationMs: Date.now() - startedAt,
                    screenshotDataUrl: result.screenshot,
                });
                // Reset retry count on success
                await (0, mongodb_1.safeWrite)(() => StyleMdRun_1.StyleMdRun.updateOne({ runId: result.runId }, { $set: { retryCount: 0 } }));
                (0, helpers_1.runIdLog)(result.runId, `[DEBUG] Pipeline completed successfully. styleMdLength=${result.styleMd?.length ?? 0}`);
            }
            catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                console.error(`[runStyleMd] Pipeline background error for ${runIdValue}:`, message);
                await (0, mongodb_1.safeWrite)(() => StyleMdRun_1.StyleMdRun.updateOne({ runId: runIdValue }, { $set: { status: "failed", error: message, updatedAt: new Date() } })).catch(() => undefined);
            }
        })();
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[runStyleMd] error:", message);
        if (!res.headersSent) {
            res.status(400).json({ ok: false, error: message });
        }
    }
}
/** GET /api/stylemd/by-slug/:slug */
async function getBySlug(req, res) {
    try {
        const { slug } = req.params;
        // Ensure DB connection is live — this is a read-only route that may be called
        // before any write route has established the connection (e.g. deep links).
        try {
            await (0, mongodb_1.connectDB)();
        }
        catch { /* proceed — connection may already be open */ }
        // Check by slug, runId, and normalized hostname slug so both
        // /by-slug/fitgreenmind and /by-slug/stylemd_1778…  work.
        const normalizedSlug = (0, persistStyleMdMongo_1.slugFromUrl)(slug.includes(".") ? `https://${slug}` : slug);
        const doc = await StyleMdRun_1.StyleMdRun.findOne({
            $or: [
                { slug },
                { runId: slug },
                ...(normalizedSlug !== "unknown" ? [{ slug: normalizedSlug }] : []),
            ],
        })
            .sort({ createdAt: -1 })
            .lean();
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
                    tokenUsage: doc.tokenUsage ?? null,
                    costEstimate: doc.costEstimate ?? null,
                    provider: doc.provider,
                    model: doc.model,
                    status: "processing",
                    pending: true,
                    createdAt: doc.createdAt?.toISOString?.() ?? String(doc.createdAt),
                },
            });
            return;
        }
        // Storage v2: design.md lives in R2. Prefer it; fall back to the legacy
        // inline/contentText resolver for pre-migration runs.
        const r2 = doc.r2 ?? null;
        const styleMd = (await (0, r2_1.fetchR2Text)(r2?.designMd)) || (await (0, resolveStyleMdFromStores_1.resolveStyleMdForRunDoc)(doc));
        if (r2?.designMd && styleMd) {
            console.log(`[CANONICAL_ARTIFACT_FOUND] Resolved styleMd from R2 for ${slug}. Length: ${styleMd.length}.`);
        }
        else {
            console.log(`[FALLBACK_TRIGGERED] Resolved styleMd for ${slug}. Length: ${styleMd.length}. (Source was fallback)`);
        }
        res.json({
            ok: true,
            data: {
                url: doc.url,
                slug: doc.slug,
                runId: doc.runId,
                styleMd,
                r2Urls: {
                    previewHtml: (0, r2_1.r2PublicUrl)(r2?.previewHtml),
                    designMd: (0, r2_1.r2PublicUrl)(r2?.designMd),
                    screenshot: (0, r2_1.r2PublicUrl)(r2?.screenshot),
                },
                designTokens: doc.designTokens ?? null,
                images: doc.images ?? [],
                tokenUsage: doc.tokenUsage ?? null,
                costEstimate: doc.costEstimate ?? null,
                title: doc.title,
                description: doc.description,
                h1: doc.h1,
                canonical: doc.canonical,
                brandAssets: doc.brandAssets,
                screenshot: (0, r2_1.r2PublicUrl)(r2?.screenshot) ?? doc.screenshot,
                provider: doc.provider,
                model: doc.model,
                status: doc.status,
                createdAt: doc.createdAt?.toISOString?.() ?? String(doc.createdAt),
            },
        });
    }
    catch (err) {
        console.error("[getBySlug] error:", err instanceof Error ? err.message : String(err));
        res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
}
/** GET /api/stylemd/runs */
async function listStyleMdRuns(req, res) {
    try {
        const runs = await StyleMdRun_1.StyleMdRun.find({})
            .sort({ createdAt: -1 })
            .select("url slug runId provider model status createdAt title brandAssets tokenUsage costEstimate")
            .lean();
        res.json({
            ok: true,
            data: runs.map((r) => ({
                id: r.runId ?? r.slug ?? r.url,
                url: r.url,
                slug: r.slug,
                title: r.title,
                brandAssets: r.brandAssets,
                provider: r.provider ?? "kimi",
                model: r.model,
                status: r.status ?? "completed",
                tokenUsage: r.tokenUsage ?? null,
                costEstimate: r.costEstimate ?? null,
                createdAt: r.createdAt?.toISOString?.() ?? String(r.createdAt),
            })),
        });
    }
    catch (err) {
        res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
}
async function fetchImageAsBase64(req, res) {
    try {
        const { path: filePath } = req.body;
        if (!filePath) {
            res.status(400).json({ ok: false, error: "Missing path" });
            return;
        }
        const buffer = await (0, promises_1.readFile)(filePath);
        const base64 = buffer.toString("base64");
        const ext = filePath.toLowerCase().endsWith(".png") ? "png" : "jpeg";
        const mimeType = ext === "png" ? "image/png" : "image/jpeg";
        res.json({ ok: true, data: `data:${mimeType};base64,${base64}` });
    }
    catch (err) {
        res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
}
