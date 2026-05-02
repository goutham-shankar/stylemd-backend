import mongoose from "mongoose";

const ScrapedSchema = new mongoose.Schema({
  url: { type: String, required: true, unique: true, index: true },
  title: { type: String, default: null },
  description: { type: String, default: null },
  h1: { type: String, default: null },
  canonical: { type: String, default: null },
  images: { type: [String], default: [] },
  contentText: { type: String, default: null },
  rawHtml: { type: String, default: null },
  createdAt: { type: Date, default: () => new Date() },
}, { collection: "scraped_data" });

export const ScrapedData = mongoose.models["ScrapedData"] || mongoose.model("ScrapedData", ScrapedSchema);
