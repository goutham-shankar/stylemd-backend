"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.slugFromUrl = slugFromUrl;
exports.ensureUniqueSlug = ensureUniqueSlug;
exports.markStyleMdRunPendingInMongo = markStyleMdRunPendingInMongo;
exports.persistStyleMdAfterGeneration = persistStyleMdAfterGeneration;
const mongodb_1 = require("@/lib/mongodb");
const StyleMdRun_1 = require("@/backend/src/models/StyleMdRun");
const ScrapedData_1 = require("@/backend/src/models/ScrapedData");
const pageUrlCanonical_1 = require("@/lib/services/pageUrlCanonical");
const styleMarkdownSanitize_1 = require("@/lib/services/styleMarkdownSanitize");
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
    const canonUrl = (0, pageUrlCanonical_1.canonicalPageUrl)(input.url);
    const urlAliases = (0, pageUrlCanonical_1.pageUrlVariantsForLookup)(canonUrl);
    const existing = await StyleMdRun_1.StyleMdRun.findOne({ url: { $in: urlAliases } }).lean();
    const slug = existing?.slug?.trim() || (await ensureUniqueSlug(slugFromUrl(canonUrl)));
    const pending = {
        url: canonUrl,
        slug,
        runId: input.runId,
        provider: input.provider,
        model: input.model,
        status: "running",
        styleMd: "",
        screenshotUrl: "",
        screenshot: "",
    };
    if (existing?._id) {
        await StyleMdRun_1.StyleMdRun.updateOne({ _id: existing._id }, { $set: pending });
        return;
    }
    await StyleMdRun_1.StyleMdRun.updateOne({ url: canonUrl }, { $set: pending, $setOnInsert: { createdAt: new Date() } }, { upsert: true });
}
/**
 * Writes generated StyleMD to `stylemd_runs` and `scraped_data` (contentText).
 * Always updates the run row so `running` placeholders from {@link markStyleMdRunPendingInMongo} are cleared.
 * `scraped_data` is updated only when `styleMd` is non-empty.
 */
async function persistStyleMdAfterGeneration(input) {
    const canonUrl = (0, pageUrlCanonical_1.canonicalPageUrl)(input.url);
    const rawMd = (0, styleMarkdownSanitize_1.stripLeadingModelPreamble)(input.styleMd ?? "");
    const styleMd = rawMd.trim();
    const screenshot = input.screenshot?.trim() ?? "";
    const screenshotUrl = input.screenshotUrl?.trim() ?? "";
    await (0, mongodb_1.connectMongo)();
    // Reuse existing record's slug (e.g., set by markStyleMdRunPendingInMongo) to prevent
    // ensureUniqueSlug from generating a new suffix ("levainbakery-2") for a URL that
    // already has a pending record with slug "levainbakery".
    const existingSlug = input.slug == null
        ? (await StyleMdRun_1.StyleMdRun.findOne({ url: { $in: (0, pageUrlCanonical_1.pageUrlVariantsForLookup)(canonUrl) } })
            .select("slug")
            .lean())?.slug?.trim() ?? ""
        : "";
    const slug = input.slug ?? (existingSlug || (await ensureUniqueSlug(slugFromUrl(canonUrl))));
    const now = new Date();
    const hasStyleMd = Boolean(styleMd);
    const hasScreenshot = Boolean(screenshot) || Boolean(screenshotUrl);
    const status = input.runStatus ??
        (!hasStyleMd && !hasScreenshot
            ? "failed"
            : hasStyleMd
                ? "completed"
                : "completed_with_warnings");
    const runData = {
        url: canonUrl,
        slug,
        runId: input.runId,
        provider: input.provider,
        model: input.model,
        styleMd,
        screenshotUrl,
        screenshot,
        status,
        createdAt: now,
    };
    try {
        await StyleMdRun_1.StyleMdRun.create(runData);
        console.log("[persistStyleMdAfterGeneration] Saved stylemd_runs", { runId: input.runId, slug, url: canonUrl });
    }
    catch (dbErr) {
        const code = typeof dbErr === "object" && dbErr !== null && "code" in dbErr ? dbErr.code : undefined;
        if (code === 11000) {
            const hit = await StyleMdRun_1.StyleMdRun.findOne({
                url: { $in: (0, pageUrlCanonical_1.pageUrlVariantsForLookup)(canonUrl) },
            }).lean();
            if (hit?._id) {
                await StyleMdRun_1.StyleMdRun.updateOne({ _id: hit._id }, { $set: runData });
            }
            else {
                await StyleMdRun_1.StyleMdRun.updateOne({ url: canonUrl }, { $set: runData });
            }
            console.log("[persistStyleMdAfterGeneration] Upserted stylemd_runs (duplicate key)", { url: canonUrl });
        }
        else {
            throw dbErr;
        }
    }
    if (hasStyleMd) {
        const aliases = (0, pageUrlCanonical_1.pageUrlVariantsForLookup)(canonUrl);
        const scrapedHit = await ScrapedData_1.ScrapedData.findOne({ url: { $in: aliases } })
            .sort({ createdAt: -1 })
            .lean();
        const scrapedPayload = { url: canonUrl, contentText: styleMd, createdAt: now };
        if (scrapedHit?._id) {
            await ScrapedData_1.ScrapedData.updateOne({ _id: scrapedHit._id }, { $set: scrapedPayload });
        }
        else {
            try {
                await ScrapedData_1.ScrapedData.create(scrapedPayload);
            }
            catch (again) {
                const c2 = typeof again === "object" && again !== null && "code" in again ?
                    again.code
                    : undefined;
                if (c2 === 11000) {
                    await ScrapedData_1.ScrapedData.updateOne({ url: canonUrl }, { $set: { contentText: styleMd, createdAt: now } });
                }
                else
                    throw again;
            }
        }
    }
    return { slug };
}
