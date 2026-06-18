import mongoose from "mongoose";

// volt_designs — registry of Volt-sourced design entries.
//
// Volt designs are fetched from the Volt API (or cached inline) and served
// as a second-tier source before falling back to live scraping.
const VoltDesignSchema = new mongoose.Schema(
  {
    url:         { type: String, required: true, index: true },
    domain:      { type: String, default: null, index: true }, // derived from url
    active:      { type: Boolean, default: true, index: true },
    label:       { type: String, default: null },
    apiEndpoint: { type: String, default: null }, // Volt API endpoint to fetch fresh designMd
    designMd:    { type: String, default: null }, // cached content (filled after first fetch)
    cachedAt:    { type: Date, default: null },
    notes:       { type: String, default: null },
    createdAt:   { type: Date, default: () => new Date() },
    updatedAt:   { type: Date, default: () => new Date() },
  },
  { collection: "volt_designs" },
);

VoltDesignSchema.index({ url: 1, active: 1 });

export const VoltDesign =
  mongoose.models["VoltDesign"] || mongoose.model("VoltDesign", VoltDesignSchema);
