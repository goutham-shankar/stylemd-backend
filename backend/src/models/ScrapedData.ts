import mongoose from "mongoose";

// ---------------------------------------------------------------------------
// scraped_data collection — single source of truth for scraped page data.
// images[] is the ONLY image store; base64 screenshot is always images[0].
// Legacy fields (screenshot, screenshotUrl) are intentionally absent.
// ---------------------------------------------------------------------------
const ScrapedSchema = new mongoose.Schema(
  {
    url:         { type: String, required: true, unique: true, index: true },
    title:       { type: String, default: null },
    description: { type: String, default: null },
    h1:          { type: String, default: null },
    canonical:   { type: String, default: null },
    images:      { type: [String], default: [] },
    contentText: { type: String, default: null },
    rawHtml:     { type: String, default: null },
    createdAt:   { type: Date, default: () => new Date() },
  },
  { collection: "scraped_data" },
);

export const ScrapedData =
  mongoose.models["ScrapedData"] || mongoose.model("ScrapedData", ScrapedSchema);
