"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.StyleMdRun = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
// ---------------------------------------------------------------------------
// stylemd_runs — per-run pipeline analytics record.
//
// Storage rule: large artifacts (styleMd text, full design-token manifest,
// semantic structure, base64 screenshot, brand asset PNGs) live in R2 under
// `websites/{slug}/...`. This collection stores ONLY queryable analytics:
// tokens, cost, summary stats, and R2 KEYS pointing at the artifacts.
//
// `strict: false` allows legacy fields (styleMd, images, screenshot,
// brandAssets, extractionMetadata.semanticStructure, ...) to remain readable
// during the v1→v2 migration; `scripts/migrate-storage-v2.ts` drops them.
// ---------------------------------------------------------------------------
// manifest.json + debug/raw.html paths are derivable from slug — not stored.
const R2KeysSchema = new mongoose_1.default.Schema({
    slug: { type: String, default: null },
    previewHtml: { type: String, default: null },
    designMd: { type: String, default: null }, // The styleMd text
    screenshot: { type: String, default: null },
    semanticStructure: { type: String, default: null },
    designTokens: { type: String, default: null },
    assets: {
        logo: { type: String, default: null },
        favicon: { type: String, default: null },
        appleIcon: { type: String, default: null },
        ogImage: { type: String, default: null },
    },
}, { _id: false });
const SummarySchema = new mongoose_1.default.Schema({
    primaryColors: { type: [String], default: [] },
    typographyFamilies: { type: [String], default: [] },
    sectionCount: { type: Number, default: 0 },
    componentCount: { type: Number, default: 0 },
    confidenceScore: { type: Number, default: 0 },
    scannedElements: { type: Number, default: 0 },
}, { _id: false });
const StyleMdRunSchema = new mongoose_1.default.Schema({
    runId: { type: String, required: true, unique: true, index: true },
    url: { type: String, required: true, index: true },
    slug: { type: String, default: null },
    provider: { type: String, default: "kimi" },
    model: { type: String, default: null },
    status: { type: String, default: "running", index: true },
    error: { type: String, default: null },
    // Lightweight site metadata (duplicated from scraped_data for run-centric queries)
    title: { type: String, default: null },
    description: { type: String, default: null },
    h1: { type: String, default: null },
    canonical: { type: String, default: null },
    // Analytics — small, queryable (KEEP inline)
    designTokens: { type: mongoose_1.default.Schema.Types.Mixed, default: null }, // stylemd-json
    tokenUsage: { type: mongoose_1.default.Schema.Types.Mixed, default: null },
    costEstimate: { type: mongoose_1.default.Schema.Types.Mixed, default: null },
    summary: { type: SummarySchema, default: () => ({}) },
    durationMs: { type: Number, default: null },
    // R2 keys (NOT URLs)
    r2: { type: R2KeysSchema, default: () => ({}) },
    // Versioning
    pipelineVersion: { type: String, default: null },
    workerVersion: { type: String, default: null },
    storageVersion: { type: String, default: null },
    createdAt: { type: Date, default: () => new Date(), index: true },
    updatedAt: { type: Date, default: () => new Date() },
    lastScrapedAt: { type: Date, default: null },
}, { collection: "stylemd_runs", strict: false });
// Compound: "runs for URL, newest first" — frontend run-history UI
StyleMdRunSchema.index({ url: 1, createdAt: -1 });
exports.StyleMdRun = mongoose_1.default.models["StyleMdRun"] || mongoose_1.default.model("StyleMdRun", StyleMdRunSchema);
