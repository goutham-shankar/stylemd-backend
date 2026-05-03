"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.slugFromUrl = slugFromUrl;
exports.ensureUniqueSlug = ensureUniqueSlug;
exports.markStyleMdRunPendingInMongo = markStyleMdRunPendingInMongo;
exports.persistStyleMdAfterGeneration = persistStyleMdAfterGeneration;
const mongodb_1 = require("@/lib/mongodb");
const StyleMdRun_1 = require("@/backend/src/models/StyleMdRun");
const ScrapedData_1 = require("@/backend/src/models/ScrapedData");
/**
 * Generate a URL-friendly slug from a URL (e.g. youtube.com → "youtube").
 */
function slugFromUrl(rawUrl) {
    try {
        const hostname = new URL(rawUrl).hostname;
        const parts = hostname.replace(/^www\./, "").split(".");
        const name = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
        return name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    }
    catch {
        return "unknown";
    }
}
async function ensureUniqueSlug(base) {
    const existing = await StyleMdRun_1.StyleMdRun.findOne({ slug: base }).lean();
    if (!existing)
        return base;
    for (let i = 2; i <= 999; i++) {
        const candidate = `${base}-${i}`;
        const clash = await StyleMdRun_1.StyleMdRun.findOne({ slug: candidate }).lean();
        if (!clash)
            return candidate;
    }
    return `${base}-${Date.now()}`;
}
/**
 * Record an artifact-pipeline run as soon as it starts so `GET /api/stylemd/by-slug/:runId`
 * can resolve the `runId` before the pipeline finishes (avoids 404 race with the frontend).
 */
async function markStyleMdRunPendingInMongo(input) {
    await (0, mongodb_1.connectMongo)();
    const existing = await StyleMdRun_1.StyleMdRun.findOne({ url: input.url }).lean();
    const slug = existing?.slug?.trim() || (await ensureUniqueSlug(slugFromUrl(input.url)));
    await StyleMdRun_1.StyleMdRun.updateOne({ url: input.url }, {
        $set: {
            url: input.url,
            slug,
            runId: input.runId,
            provider: input.provider,
            model: input.model,
            status: "running",
            styleMd: "",
            screenshotUrl: "",
            screenshot: "",
        },
        $setOnInsert: { createdAt: new Date() },
    }, { upsert: true });
}
/**
 * Writes generated StyleMD to `stylemd_runs` and `scraped_data` (contentText).
 * Safe to call after scrape + styleguide; duplicates on `url` are upserted (same as API handler).
 */
async function persistStyleMdAfterGeneration(input) {
    const styleMd = input.styleMd?.trim() ?? "";
    if (!styleMd) {
        console.warn("[persistStyleMdAfterGeneration] Skipping MongoDB persist: empty styleMd", {
            url: input.url,
            runId: input.runId,
        });
        return undefined;
    }
    await (0, mongodb_1.connectMongo)();
    const slug = input.slug ?? (await ensureUniqueSlug(slugFromUrl(input.url)));
    const now = new Date();
    const runData = {
        url: input.url,
        slug,
        runId: input.runId,
        provider: input.provider,
        model: input.model,
        styleMd,
        screenshotUrl: input.screenshotUrl,
        screenshot: input.screenshot,
        status: "completed",
        createdAt: now,
    };
    try {
        await StyleMdRun_1.StyleMdRun.create(runData);
        console.log("[persistStyleMdAfterGeneration] Saved stylemd_runs", { runId: input.runId, slug, url: input.url });
    }
    catch (dbErr) {
        const code = typeof dbErr === "object" && dbErr !== null && "code" in dbErr ? dbErr.code : undefined;
        if (code === 11000) {
            await StyleMdRun_1.StyleMdRun.updateOne({ url: input.url }, { $set: runData });
            console.log("[persistStyleMdAfterGeneration] Upserted stylemd_runs (duplicate key)", { url: input.url });
        }
        else {
            throw dbErr;
        }
    }
    await ScrapedData_1.ScrapedData.findOneAndUpdate({ url: input.url }, {
        url: input.url,
        contentText: styleMd,
        createdAt: now,
    }, { upsert: true, new: true });
    return { slug };
}
