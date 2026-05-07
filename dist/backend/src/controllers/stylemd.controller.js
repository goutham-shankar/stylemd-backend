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
const validation_1 = require("../utils/validation");
const requestSchema = zod_1.z.object({
    url: zod_1.z.string().url(),
    provider: zod_1.z.enum(["claude", "kimi"]).optional().default("kimi"),
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
        const { url, provider } = requestSchema.parse(req.body);
        const canonUrl = (0, pageUrlCanonical_1.canonicalPageUrl)(url);
        const slug = (0, persistStyleMdMongo_1.slugFromUrl)(canonUrl);
        // --- Cache hit (find LATEST run for this slug) ---
        const existing = await StyleMdRun_1.StyleMdRun.findOne({ slug })
            .sort({ createdAt: -1 })
            .lean();
        // STRICT validity check: return cached only if valid
        const isValid = existing && existing.status !== "running" && existing.styleMd?.trim() && (0, validation_1.isValidScrapedRecord)(existing);
        if (isValid) {
            console.log(`[STYLEMD] cache-hit (valid) slug=${slug}`);
            res.json({
                ok: true,
                data: {
                    url: existing.url,
                    slug: existing.slug,
                    runId: existing.runId,
                    styleMd: existing.styleMd,
                    images: existing.images ?? [],
                    provider: existing.provider,
                    model: existing.model,
                    status: existing.status,
                    createdAt: existing.createdAt?.toISOString?.() ?? String(existing.createdAt),
                },
                cached: true,
            });
            return;
        }
        if (existing && !isValid && existing.status !== "running") {
            const retries = existing.retryCount || 0;
            if (retries >= 2) {
                console.warn(`[STYLEMD] max retries reached for ${slug}, returning last known data`);
                res.json({
                    ok: true,
                    data: {
                        url: existing.url,
                        slug: existing.slug,
                        runId: existing.runId,
                        styleMd: existing.styleMd,
                        images: existing.images ?? [],
                        provider: existing.provider,
                        model: existing.model,
                        status: existing.status,
                        createdAt: existing.createdAt?.toISOString?.() ?? String(existing.createdAt),
                    },
                    cached: true,
                });
                return;
            }
            console.log(`[STYLEMD] invalid cache detected, re-scraping (attempt ${retries + 1}): ${slug}`);
            await (0, mongodb_1.safeWrite)(() => StyleMdRun_1.StyleMdRun.updateOne({ runId: existing.runId }, { $inc: { retryCount: 1 } }));
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
        // --- Run the pipeline ---
        // The pipeline now handles its own persistence into MongoDB.
        const result = await (0, simplifiedPipeline_1.runSimplifiedStyleMdPipeline)(canonUrl, provider);
        // Reset retry count on success (keyed by runId)
        await (0, mongodb_1.safeWrite)(() => StyleMdRun_1.StyleMdRun.updateOne({ runId: result.runId }, { $set: { retryCount: 0 } }));
        const now = new Date();
        res.json({
            ok: true,
            data: {
                url: canonUrl,
                slug,
                runId: result.runId,
                provider,
                model: result.model,
                styleMd: result.styleMd,
                images: result.screenshot ? [result.screenshot] : [],
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
/** GET /api/stylemd/by-slug/:slug */
async function getBySlug(req, res) {
    try {
        const { slug } = req.params;
        // 🔴 FETCH LATEST RUN BY SLUG (or specific runId)
        // We check:
        // 1. Exact slug match
        // 2. Exact runId match
        // 3. Normalized slug match (in case frontend passes full hostname)
        const normalizedSlug = (0, persistStyleMdMongo_1.slugFromUrl)(slug.includes(".") ? `https://${slug}` : slug);
        const doc = await StyleMdRun_1.StyleMdRun.findOne({
            $or: [
                { slug },
                { runId: slug },
                { slug: normalizedSlug }
            ],
        })
            .sort({ createdAt: -1 })
            .lean();
        if (!doc) {
            console.warn(`[getBySlug] No run found for slug/runId/normalized: ${slug} / ${normalizedSlug}`);
            res.status(404).json({ ok: false, error: `No run found for slug: ${slug}` });
            return;
        }
        const styleMd = await (0, resolveStyleMdFromStores_1.resolveStyleMdForRunDoc)(doc);
        res.json({
            ok: true,
            data: {
                url: doc.url,
                slug: doc.slug,
                runId: doc.runId,
                styleMd,
                images: doc.images ?? [],
                title: doc.title,
                description: doc.description,
                h1: doc.h1,
                canonical: doc.canonical,
                brandAssets: doc.brandAssets,
                screenshot: doc.screenshot,
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
            .select("url slug runId provider model status createdAt title screenshot")
            .lean();
        res.json({
            ok: true,
            data: runs.map((r) => ({
                id: r.runId ?? r.slug ?? r.url,
                url: r.url,
                slug: r.slug,
                title: r.title,
                screenshot: r.screenshot,
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
