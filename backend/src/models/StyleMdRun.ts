import mongoose from "mongoose";

// ---------------------------------------------------------------------------
// stylemd_runs collection — tracks StyleMD generation runs.
// Clean schema: removed legacy fields, enforcing images: string[].
// ---------------------------------------------------------------------------
const StyleMdRunSchema = new mongoose.Schema({
  url: { type: String, required: true, unique: true, index: true },
  slug: { type: String, unique: true, index: true },
  provider: { type: String, default: "kimi" },
  model: { type: String },
  runId: { type: String, index: true },
  styleMd: { type: String },
  images: { type: [String], default: [] }, // base64 ONLY
  status: { type: String, default: "completed" },
  createdAt: { type: Date, default: () => new Date() },
}, { collection: "stylemd_runs" });

export const StyleMdRun = mongoose.models["StyleMdRun"] || mongoose.model("StyleMdRun", StyleMdRunSchema);
