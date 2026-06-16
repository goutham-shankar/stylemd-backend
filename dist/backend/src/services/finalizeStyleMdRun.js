"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.finalizeStyleMdRun = finalizeStyleMdRun;
/**
 * Shared "finish line" for a StyleMD pipeline run: render preview.html +
 * design.md, upload every artifact to R2, patch Mongo with the resulting
 * keys, then delete the local .playground/<runId>/ scratch dir.
 *
 * runSimplifiedStyleMdPipeline() only generates content in-memory and writes
 * slim analytics to Mongo — it deliberately leaves this step to the caller
 * (see the comment in simplifiedPipeline.ts: "HTML/markdown/screenshots are
 * uploaded to R2 by the worker after this pipeline completes"). Both the
 * BullMQ worker and the direct /api/stylemd path call this function so a run
 * is actually retrievable afterwards regardless of which path produced it.
 */
const promises_1 = require("node:fs/promises");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const r2_1 = require("../../../lib/queue/r2");
const mongodb_1 = require("../../../lib/mongodb");
const artifacts_1 = require("../../../lib/stylemd-artifacts/artifacts");
const designSystemRenderer_1 = require("./designSystemRenderer");
const runStorage_1 = require("./runStorage");
const ScrapedData_1 = require("../models/ScrapedData");
const StyleMdRun_1 = require("../models/StyleMdRun");
function dataUrlToBuffer(dataUrl) {
    const m = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl);
    if (!m)
        return null;
    return { contentType: m[1], buffer: Buffer.from(m[2], "base64") };
}
async function readRunJson(runDir, name) {
    const path = (0, node_path_1.join)(runDir, name);
    if (!(0, node_fs_1.existsSync)(path))
        return null;
    try {
        return await (0, promises_1.readFile)(path, "utf-8");
    }
    catch {
        return null;
    }
}
async function readRunScreenshot(runDir) {
    const path = (0, node_path_1.join)(runDir, "full_screenshot.png");
    if (!(0, node_fs_1.existsSync)(path))
        return null;
    try {
        return await (0, promises_1.readFile)(path);
    }
    catch {
        return null;
    }
}
async function finalizeStyleMdRun(input) {
    const { runId, url, durationMs, debugMode = false } = input;
    const runDir = (0, artifacts_1.getStyleMdRunDir)(runId);
    const slug = (0, runStorage_1.urlToSlug)(url);
    const rendered = await (0, designSystemRenderer_1.renderFromRunDir)(runDir, url);
    if (!rendered) {
        throw new Error(`render produced no output for runDir=${runDir}`);
    }
    const r2 = {};
    r2.previewHtml = await (0, r2_1.uploadR2)((0, r2_1.r2KeyFor)(slug, "previewHtml"), rendered.html, "text/html; charset=utf-8");
    r2.designMd = await (0, r2_1.uploadR2)((0, r2_1.r2KeyFor)(slug, "designMd"), rendered.md, "text/markdown; charset=utf-8");
    const shot = input.screenshotDataUrl ? dataUrlToBuffer(input.screenshotDataUrl) : null;
    if (shot) {
        r2.screenshot = await (0, r2_1.uploadR2)((0, r2_1.r2KeyFor)(slug, "screenshot"), shot.buffer, shot.contentType);
    }
    else {
        const png = await readRunScreenshot(runDir);
        if (png)
            r2.screenshot = await (0, r2_1.uploadR2)((0, r2_1.r2KeyFor)(slug, "screenshot"), png, "image/png");
    }
    const semanticStructure = await readRunJson(runDir, "semantic_structure.json");
    if (semanticStructure) {
        r2.semanticStructure = await (0, r2_1.uploadR2)((0, r2_1.r2KeyFor)(slug, "semanticStructure"), semanticStructure, "application/json");
    }
    const semanticAnalysis = await readRunJson(runDir, "semantic_analysis.json");
    if (semanticAnalysis) {
        r2.designTokens = await (0, r2_1.uploadR2)((0, r2_1.r2KeyFor)(slug, "designTokens"), semanticAnalysis, "application/json");
    }
    let debugRawUploaded = false;
    if (debugMode) {
        const rawHtml = await readRunJson(runDir, "raw.html");
        if (rawHtml) {
            await (0, r2_1.uploadR2)((0, r2_1.r2KeyFor)(slug, "rawHtml"), rawHtml, "text/html; charset=utf-8");
            debugRawUploaded = true;
        }
    }
    const domain = (() => {
        try {
            return new URL(url).hostname;
        }
        catch {
            return slug;
        }
    })();
    const manifest = (0, r2_1.buildManifest)({
        domain,
        slug,
        generatedAt: new Date(),
        has: {
            screenshot: Boolean(r2.screenshot),
            designTokens: Boolean(r2.designTokens),
            semanticStructure: Boolean(r2.semanticStructure),
            rawHtml: debugRawUploaded,
        },
    });
    await (0, r2_1.uploadR2)((0, r2_1.r2KeyFor)(slug, "manifest"), JSON.stringify(manifest, null, 2), "application/json");
    const r2Doc = {
        slug,
        previewHtml: r2.previewHtml || null,
        designMd: r2.designMd || null,
        screenshot: r2.screenshot || null,
        semanticStructure: r2.semanticStructure || null,
        designTokens: r2.designTokens || null,
        assets: {},
    };
    const versions = {
        pipelineVersion: r2_1.PIPELINE_VERSION,
        workerVersion: r2_1.WORKER_VERSION,
        storageVersion: r2_1.STORAGE_VERSION,
    };
    await (0, mongodb_1.safeWrite)(() => ScrapedData_1.ScrapedData.updateOne({ url }, {
        $set: {
            url,
            slug,
            status: "completed",
            runId,
            durationMs,
            error: null,
            r2: r2Doc,
            ...versions,
            updatedAt: new Date(),
            lastScrapedAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date() },
    }, { upsert: true }));
    await (0, mongodb_1.safeWrite)(() => StyleMdRun_1.StyleMdRun.updateOne({ runId }, {
        $set: {
            slug,
            status: "completed",
            durationMs,
            r2: r2Doc,
            ...versions,
            updatedAt: new Date(),
            lastScrapedAt: new Date(),
        },
    }));
    try {
        await (0, promises_1.rm)(runDir, { recursive: true, force: true });
    }
    catch (e) {
        console.warn(`[finalizeStyleMdRun] cleanup failed for ${runDir}:`, e instanceof Error ? e.message : String(e));
    }
    return r2Doc;
}
