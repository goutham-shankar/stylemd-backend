"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clearCache = clearCache;
exports.runStyleMd = runStyleMd;
exports.getBySlug = getBySlug;
exports.listStyleMdRuns = listStyleMdRuns;
const zod_1 = require("zod");
const provider_1 = require("@/lib/stylemd-artifacts/provider");
const simplifiedPipeline_1 = require("@/lib/stylemd-artifacts/simplifiedPipeline");
const mongodb_1 = require("@/lib/mongodb");
const persistStyleMdMongo_1 = require("@/lib/services/persistStyleMdMongo");
const StyleMdRun_1 = require("../models/StyleMdRun");
const requestSchema = zod_1.z.object({
    url: zod_1.z.string().url(),
    provider: zod_1.z.enum(["claude", "kimi"]).optional().default("kimi"),
});
async function clearCache(_req, res) {
    try {
        await (0, mongodb_1.connectMongo)();
        await StyleMdRun_1.StyleMdRun.deleteMany({});
        res.json({ ok: true, message: "Cache cleared" });
    }
    catch (err) {
        res
            .status(500)
            .json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
}
async function runStyleMd(req, res) {
    // The pipeline can run for 5–10 minutes. Disable the default socket timeout
    // for this specific request so the connection stays open until completion.
    req.socket.setTimeout(0);
    res.setTimeout(0);
    try {
        const { url, provider } = requestSchema.parse(req.body);
        await (0, mongodb_1.connectMongo)();
        // --- Cache hit (skip in-flight artifact runs and empty placeholders) ---
        const existing = await StyleMdRun_1.StyleMdRun.findOne({ url }).lean();
        if (existing && existing.status !== "running" && existing.styleMd?.trim()) {
            res.json({
                ok: true,
                data: {
                    url: existing.url,
                    slug: existing.slug ?? (0, persistStyleMdMongo_1.slugFromUrl)(existing.url),
                    runId: existing.runId,
                    styleMd: existing.styleMd,
                    screenshotUrl: existing.screenshotUrl,
                    screenshot: existing.screenshot ?? "",
                    provider: existing.provider,
                    model: existing.model,
                    status: existing.status,
                    createdAt: existing.createdAt?.toISOString?.() ?? String(existing.createdAt),
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
        const credentialError = (0, provider_1.validateStyleMdProviderCredentials)(provider);
        if (credentialError) {
            res.status(400).json({ ok: false, error: credentialError });
            return;
        }
        // --- Run the pipeline ---
        const result = await (0, simplifiedPipeline_1.runSimplifiedStyleMdPipeline)(url, provider);
        const slugBase = await (0, persistStyleMdMongo_1.ensureUniqueSlug)((0, persistStyleMdMongo_1.slugFromUrl)(url));
        const persisted = await (0, persistStyleMdMongo_1.persistStyleMdAfterGeneration)({
            url,
            runId: result.runId,
            provider,
            model: result.model,
            styleMd: result.styleMd,
            screenshotUrl: result.screenshotUrl,
            screenshot: result.screenshot,
            slug: slugBase,
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
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[runStyleMd] error:", message);
        if (!res.headersSent) {
            res.status(400).json({ ok: false, error: message });
        }
    }
}
/** GET /api/stylemd/by-slug/:slug — retrieve a cached run by its human-readable slug or runId */
async function getBySlug(req, res) {
    try {
        const { slug } = req.params;
        await (0, mongodb_1.connectMongo)();
        // Look up by slug first, then fall back to runId for backwards compat
        // This supports: human-readable slugs (youtube), URL-safe slugs (youtube-2), and runIds (stylemd_1234567)
        const doc = await StyleMdRun_1.StyleMdRun.findOne({
            $or: [{ slug }, { runId: slug }],
        }).lean();
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
                slug: doc.slug ?? (0, persistStyleMdMongo_1.slugFromUrl)(doc.url),
                runId: doc.runId,
                styleMd: doc.styleMd ?? "",
                screenshotUrl: doc.screenshotUrl ?? "",
                screenshot: doc.screenshot ?? "",
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
/** GET /api/stylemd/runs — list all completed StyleMD runs for the library */
async function listStyleMdRuns(req, res) {
    try {
        await (0, mongodb_1.connectMongo)();
        const runs = await StyleMdRun_1.StyleMdRun.find({})
            .sort({ createdAt: -1 })
            .select("url slug runId provider model status createdAt")
            .lean();
        res.json({
            ok: true,
            summaries: runs.map((r) => ({
                id: r.runId ?? r.slug ?? r.url,
                url: r.url,
                slug: r.slug ?? (0, persistStyleMdMongo_1.slugFromUrl)(r.url),
                provider: r.provider ?? "kimi",
                model: r.model,
                status: r.status ?? "completed",
                createdAt: r.createdAt?.toISOString?.() ?? String(r.createdAt),
            })),
        });
    }
    catch (err) {
        res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
}
