"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.slugFromUrl = slugFromUrl;
exports.markStyleMdRunPendingInMongo = markStyleMdRunPendingInMongo;
exports.persistStyleMdAfterGeneration = persistStyleMdAfterGeneration;
const mongodb_1 = require("../../lib/mongodb");
const StyleMdRun_1 = require("../../backend/src/models/StyleMdRun");
const pageUrlCanonical_1 = require("../../lib/services/pageUrlCanonical");
const styleMarkdownSanitize_1 = require("../../lib/services/styleMarkdownSanitize");
/**
 * Generate a deterministic, stable slug from a URL.
 * Stable across runs, not unique per execution.
 */
function slugFromUrl(url) {
    try {
        return new URL(url).hostname
            .replace("www.", "")
            .replace(".com", "")
            .replace(".in", "")
            .replace(".co", "")
            .replace(/[^a-z0-9]/g, "");
    }
    catch {
        return "unknown";
    }
}
/**
 * Record an artifact-pipeline run as soon as it starts.
 * Upsert is keyed by runId.
 */
async function markStyleMdRunPendingInMongo(input) {
    const canonUrl = (0, pageUrlCanonical_1.canonicalPageUrl)(input.url);
    const slug = slugFromUrl(canonUrl);
    const pending = {
        url: canonUrl,
        slug,
        runId: input.runId,
        provider: input.provider,
        model: input.model,
        status: "running",
        styleMd: "",
        images: [],
        updatedAt: new Date(),
    };
    // 🟠 UPSERT BY runId
    await (0, mongodb_1.safeWrite)(() => StyleMdRun_1.StyleMdRun.updateOne({ runId: input.runId }, { $set: pending, $setOnInsert: { createdAt: new Date() } }, { upsert: true }));
}
/**
 * Writes generated StyleMD to `stylemd_runs`.
 * Upsert is keyed by runId.
 */
async function persistStyleMdAfterGeneration(input) {
    const canonUrl = (0, pageUrlCanonical_1.canonicalPageUrl)(input.url);
    const rawMd = (0, styleMarkdownSanitize_1.stripLeadingModelPreamble)(input.styleMd ?? "");
    const styleMd = rawMd.trim();
    let screenshot = input.screenshot?.trim() ?? "";
    // MongoDB 16MB document limit
    if (screenshot.length > 5 * 1024 * 1024) {
        console.warn(`[persistStyleMdAfterGeneration] Screenshot base64 is too large, dropping.`);
        screenshot = "";
    }
    const slug = input.slug || slugFromUrl(canonUrl);
    const now = new Date();
    const hasStyleMd = Boolean(styleMd);
    const hasScreenshot = Boolean(screenshot);
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
        status,
        updatedAt: now,
        title: input.title,
        description: input.description,
        h1: input.h1,
        canonical: input.canonical,
    };
    if (hasScreenshot) {
        runData.screenshot = screenshot;
        runData.images = [screenshot];
    }
    if (input.brandAssets) {
        runData.brandAssets = input.brandAssets;
    }
    // 🟠 UPSERT BY runId
    await (0, mongodb_1.safeWrite)(() => StyleMdRun_1.StyleMdRun.updateOne({ runId: input.runId }, { $set: runData, $setOnInsert: { createdAt: new Date() } }, { upsert: true }));
    console.log("[persistStyleMdAfterGeneration] Persisted stylemd_runs (upsert)", {
        runId: input.runId,
        slug,
        url: canonUrl
    });
    return { slug };
}
