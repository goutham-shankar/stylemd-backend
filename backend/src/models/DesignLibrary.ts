import mongoose from "mongoose";

// design_library — curated, human-verified DESIGN.md entries.
//
// Library entries are the highest-priority tier: zero inference cost,
// maximum quality. Matched by exact URL before trying Volt or live scrape.
const DesignLibrarySchema = new mongoose.Schema(
  {
    url:       { type: String, required: true, unique: true, index: true },
    active:    { type: Boolean, default: true, index: true },
    label:     { type: String, default: null },
    designMd:  { type: String, required: true },
    notes:     { type: String, default: null },
    addedBy:   { type: String, default: null }, // firebase uid
    createdAt: { type: Date, default: () => new Date() },
    updatedAt: { type: Date, default: () => new Date() },
  },
  { collection: "design_library" },
);

DesignLibrarySchema.index({ url: 1, active: 1 });

export const DesignLibrary =
  mongoose.models["DesignLibrary"] || mongoose.model("DesignLibrary", DesignLibrarySchema);
