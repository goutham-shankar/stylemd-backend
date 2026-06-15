import mongoose from "mongoose";

// ---------------------------------------------------------------------------
// scraped_data — URL-keyed lightweight cache + status mirror.
//
// Storage rule: large artifacts (HTML, markdown, screenshot, JSON blobs) live
// in Cloudflare R2 under `websites/{slug}/...`. This collection stores ONLY
// the metadata needed to look up + render search results, plus the R2 KEYS
// pointing at the artifacts. Public URLs are constructed at read time via
// r2PublicUrl() so we can swap CDN domains without rewriting Mongo.
//
// `strict: false` is intentional during the v1→v2 migration so legacy fields
// (rawHtml, previewHtml, designMd, images, brandAssets) continue to load until
// `scripts/migrate-storage-v2.ts` drops them.
// ---------------------------------------------------------------------------

// NOTE: manifest.json is NOT stored as a key here — it's always at
// `websites/{slug}/manifest.json`, derivable from `slug`. Same reasoning
// applies to debug/raw.html when debugMode is used.
const R2KeysSchema = new mongoose.Schema(
  {
    slug:              { type: String, default: null },
    previewHtml:       { type: String, default: null }, // websites/{slug}/preview.html
    designMd:          { type: String, default: null },
    screenshot:        { type: String, default: null },
    semanticStructure: { type: String, default: null },
    designTokens:      { type: String, default: null },
    assets: {
      logo:      { type: String, default: null },
      favicon:   { type: String, default: null },
      appleIcon: { type: String, default: null },
      ogImage:   { type: String, default: null },
    },
  },
  { _id: false },
);

const ScrapedSchema = new mongoose.Schema(
  {
    url:          { type: String, required: true, unique: true, index: true },
    slug:         { type: String, index: true },

    // Lightweight site metadata
    title:        { type: String, default: null },
    description:  { type: String, default: null },
    h1:           { type: String, default: null },
    canonical:    { type: String, default: null },
    contentText:  { type: String, default: null }, // 6–20 KB; useful for search

    // Job + run linkage
    runId:        { type: String, default: null, index: true },
    status:       { type: String, default: null, index: true }, // queued | running | completed | failed
    error:        { type: String, default: null },
    durationMs:   { type: Number, default: null },

    // R2 object keys (NOT URLs — resolve via r2PublicUrl() at read time)
    r2:           { type: R2KeysSchema, default: () => ({}) },

    // Versioning — bumped when pipeline / worker / storage shape changes
    pipelineVersion: { type: String, default: null },
    workerVersion:   { type: String, default: null },
    storageVersion:  { type: String, default: null },

    createdAt:     { type: Date, default: () => new Date() },
    updatedAt:     { type: Date, default: () => new Date(), index: true },
    lastScrapedAt: { type: Date, default: null },
  },
  { collection: "scraped_data", strict: false },
);

// Compound index for admin "recent by status" queries
ScrapedSchema.index({ status: 1, updatedAt: -1 });

export const ScrapedData =
  mongoose.models["ScrapedData"] || mongoose.model("ScrapedData", ScrapedSchema);
