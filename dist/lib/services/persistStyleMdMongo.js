"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.slugFromUrl = slugFromUrl;
exports.markStyleMdRunPendingInMongo = markStyleMdRunPendingInMongo;
exports.persistStyleMdAfterGeneration = persistStyleMdAfterGeneration;
const mongodb_1 = require("../../lib/mongodb");
const StyleMdRun_1 = require("../../backend/src/models/StyleMdRun");
const pageUrlCanonical_1 = require("../../lib/services/pageUrlCanonical");
const styleMarkdownSanitize_1 = require("../../lib/services/styleMarkdownSanitize");
const helpers_1 = require("../../lib/stylemd-artifacts/helpers");
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
 *
 * Storage v2: lightweight metadata only. styleMd text + images + screenshot
 * never written to Mongo — they live in R2 keyed by slug.
 */
async function markStyleMdRunPendingInMongo(input) {
    const canonUrl = (0, pageUrlCanonical_1.canonicalPageUrl)(input.url);
    const slug = slugFromUrl(canonUrl);
    await (0, mongodb_1.safeWrite)(() => StyleMdRun_1.StyleMdRun.updateOne({ runId: input.runId }, {
        $set: {
            url: canonUrl,
            slug,
            runId: input.runId,
            provider: input.provider,
            model: input.model,
            status: "running",
            updatedAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date() },
    }, { upsert: true }));
}
/**
 * Writes generated StyleMD pipeline analytics to `stylemd_runs` (slim — storage v2).
 *
 * What lives in Mongo: tokens, cost, design-token summary, lightweight metadata.
 * What lives in R2: styleMd text, base64 screenshot, brand assets, full
 * design-token manifest, semantic structure. The worker uploads them and patches
 * in `r2.*` keys after this call returns.
 */
async function persistStyleMdAfterGeneration(input) {
    const canonUrl = (0, pageUrlCanonical_1.canonicalPageUrl)(input.url);
    const rawMd = (0, styleMarkdownSanitize_1.stripLeadingModelPreamble)(input.styleMd ?? "");
    const styleMd = rawMd.trim();
    const slug = input.slug || slugFromUrl(canonUrl);
    const now = new Date();
    const hasStyleMd = Boolean(styleMd);
    const hasScreenshot = Boolean(input.screenshot);
    const status = input.runStatus ??
        (!hasStyleMd && !hasScreenshot
            ? "failed"
            : hasStyleMd
                ? "completed"
                : "completed_with_warnings");
    // Compact summary derived from the heavy extractionMetadata (which itself
    // does NOT get persisted — too big).
    const xm = input.extractionMetadata ?? {};
    const summary = {
        primaryColors: xm.primaryColors ?? [],
        typographyFamilies: xm.typographyFamilies ?? [],
        sectionCount: xm.sectionCount ?? 0,
        componentCount: 0,
        confidenceScore: xm.confidenceScore ?? 0,
        scannedElements: xm.scannedElements ?? 0,
    };
    const runData = {
        url: canonUrl,
        slug,
        runId: input.runId,
        provider: input.provider,
        model: input.model,
        status,
        title: input.title ?? null,
        description: input.description ?? null,
        h1: input.h1 ?? null,
        canonical: input.canonical ?? null,
        designTokens: input.designTokens ?? null,
        tokenUsage: input.tokenUsage ?? null,
        costEstimate: input.costEstimate ?? null,
        summary,
        durationMs: xm.durationMs ?? null,
        updatedAt: now,
    };
    const approxBsonSize = JSON.stringify(runData).length;
    (0, helpers_1.runIdLog)(input.runId, `[DEBUG] Persisting StyleMdRun (slim). Approx BSON size: ${(approxBsonSize / 1024).toFixed(2)} KB.`);
    try {
        await (0, mongodb_1.safeWrite)(() => StyleMdRun_1.StyleMdRun.updateOne({ runId: input.runId }, { $set: runData, $setOnInsert: { createdAt: now } }, { upsert: true }));
        (0, helpers_1.runIdLog)(input.runId, `[DEBUG] StyleMdRun persisted (worker will patch r2 keys next).`);
    }
    catch (dbErr) {
        (0, helpers_1.runIdLog)(input.runId, `[DEBUG] DB ERROR during upsert: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`, "error");
        throw dbErr;
    }
    return { slug };
}
