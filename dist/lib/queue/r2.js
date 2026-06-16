"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.R2_DEBUG_ARTIFACT_NAMES = exports.R2_ARTIFACT_NAMES = exports.STORAGE_VERSION = exports.WORKER_VERSION = exports.PIPELINE_VERSION = void 0;
exports.r2KeyFor = r2KeyFor;
exports.buildManifest = buildManifest;
exports.r2PublicUrl = r2PublicUrl;
exports.uploadR2 = uploadR2;
exports.deleteR2 = deleteR2;
exports.fetchR2Text = fetchR2Text;
const client_s3_1 = require("@aws-sdk/client-s3");
// ───────────────────────────────────────────────────────────────────────────
// Version constants — bumped when pipeline output, worker code, or storage
// schema changes meaningfully. Persisted into Mongo per-run for observability.
// ───────────────────────────────────────────────────────────────────────────
exports.PIPELINE_VERSION = "1.0.0";
exports.WORKER_VERSION = "1.0.0";
exports.STORAGE_VERSION = "v2.1";
// ───────────────────────────────────────────────────────────────────────────
// R2 layout — stable structure, slug-keyed, re-scrapes overwrite.
//
//   designprobe/
//     └── websites/
//          └── {slug}/
//                ├── manifest.json            ← self-describing index (v2.1+)
//                ├── preview.html
//                ├── design.md
//                ├── screenshot.jpg
//                ├── semantic_structure.json
//                ├── design_tokens.json
//                ├── assets/
//                │     ├── logo.svg
//                │     ├── favicon.ico
//                │     └── og-image.jpg
//                └── debug/                   ← only present when debugMode=true
//                      └── raw.html
//
// Note: raw.html is NOT a default artifact in v2.1+. It only gets uploaded
// when the caller passes `debugMode: true` in the scrape request payload.
// ───────────────────────────────────────────────────────────────────────────
exports.R2_ARTIFACT_NAMES = {
    manifest: "manifest.json",
    previewHtml: "preview.html",
    designMd: "design.md",
    screenshot: "screenshot.jpg",
    semanticStructure: "semantic_structure.json",
    designTokens: "design_tokens.json",
};
/** Debug-only artifact paths (only uploaded when debugMode=true). */
exports.R2_DEBUG_ARTIFACT_NAMES = {
    rawHtml: "debug/raw.html",
};
/** Build an R2 key under the `websites/{slug}/` namespace. */
function r2KeyFor(slug, artifact) {
    // If `artifact` is one of the named artifacts, look up the filename. Otherwise
    // treat it as a literal sub-path (e.g. "assets/logo.png" or "debug/raw.html").
    const sub = exports.R2_ARTIFACT_NAMES[artifact] ??
        exports.R2_DEBUG_ARTIFACT_NAMES[artifact] ??
        artifact;
    return `websites/${slug}/${sub}`;
}
/** Filenames are relative to `websites/{slug}/` — they're stable per layout. */
function buildManifest(input) {
    const m = {
        domain: input.domain,
        slug: input.slug,
        generatedAt: (input.generatedAt ?? new Date()).toISOString(),
        pipelineVersion: exports.PIPELINE_VERSION,
        workerVersion: exports.WORKER_VERSION,
        storageVersion: exports.STORAGE_VERSION,
        artifacts: {
            previewHtml: exports.R2_ARTIFACT_NAMES.previewHtml,
            designMd: exports.R2_ARTIFACT_NAMES.designMd,
            screenshot: input.has.screenshot ? exports.R2_ARTIFACT_NAMES.screenshot : null,
            designTokens: input.has.designTokens ? exports.R2_ARTIFACT_NAMES.designTokens : null,
            semanticStructure: input.has.semanticStructure ? exports.R2_ARTIFACT_NAMES.semanticStructure : null,
        },
        assets: {
            logo: input.has.logo ? "assets/logo.svg" : null,
            favicon: input.has.favicon ? "assets/favicon.ico" : null,
            appleIcon: input.has.appleIcon ? "assets/apple-icon.png" : null,
            ogImage: input.has.ogImage ? "assets/og-image.jpg" : null,
        },
    };
    if (input.has.rawHtml) {
        m.debug = { rawHtml: exports.R2_DEBUG_ARTIFACT_NAMES.rawHtml };
    }
    return m;
}
/** Resolve an R2 key to a public URL via R2_PUBLIC_BASE. */
function r2PublicUrl(key) {
    if (!key)
        return null;
    const base = process.env.R2_PUBLIC_BASE;
    if (!base)
        return null;
    return `${base.replace(/\/+$/, "")}/${key.replace(/^\/+/, "")}`;
}
// ───────────────────────────────────────────────────────────────────────────
// S3 client — lazy, env-driven
// ───────────────────────────────────────────────────────────────────────────
function envOrThrow(key) {
    const v = process.env[key];
    if (!v)
        throw new Error(`${key} environment variable is required for R2 uploads`);
    return v;
}
let _s3 = null;
function s3() {
    if (_s3)
        return _s3;
    _s3 = new client_s3_1.S3Client({
        region: "auto",
        endpoint: envOrThrow("R2_ENDPOINT"),
        credentials: {
            accessKeyId: envOrThrow("R2_KEY"),
            secretAccessKey: envOrThrow("R2_SECRET"),
        },
    });
    return _s3;
}
/**
 * Upload to R2. Returns the *key* (not URL) — callers persist keys in Mongo
 * and resolve to URLs at read time via r2PublicUrl().
 */
async function uploadR2(key, body, contentType) {
    const bucket = envOrThrow("R2_BUCKET");
    await s3().send(new client_s3_1.PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: "public, max-age=31536000, immutable",
    }));
    return key;
}
/** Delete an object from R2 (used by migration cleanup, not the worker). */
async function deleteR2(key) {
    const bucket = envOrThrow("R2_BUCKET");
    await s3().send(new client_s3_1.DeleteObjectCommand({ Bucket: bucket, Key: key }));
}
/**
 * Fetch an object's body as text. Used on the cache-hit path to return the
 * design.md content that v2 storage keeps in R2 (not Mongo). Returns null on
 * any failure so callers can degrade gracefully rather than throw.
 */
async function fetchR2Text(key) {
    if (!key)
        return null;
    try {
        const bucket = envOrThrow("R2_BUCKET");
        const out = await s3().send(new client_s3_1.GetObjectCommand({ Bucket: bucket, Key: key }));
        const body = out.Body;
        if (body?.transformToString)
            return await body.transformToString();
        return null;
    }
    catch {
        return null;
    }
}
