"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.StyleMdRun = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
// ---------------------------------------------------------------------------
// stylemd_runs collection — tracks StyleMD generation runs.
// Clean schema: removed legacy fields, enforcing images: string[].
// ---------------------------------------------------------------------------
const StyleMdRunSchema = new mongoose_1.default.Schema({
    url: { type: String, required: true, index: true }, // Removed unique: true
    slug: { type: String, index: true }, // Removed unique: true
    provider: { type: String, default: "kimi" },
    model: { type: String },
    runId: { type: String, required: true, unique: true, index: true }, // Added unique: true and required
    styleMd: { type: String },
    images: { type: [String], default: [] }, // base64 ONLY
    screenshot: { type: String }, // 🔴 ADDED: Primary base64 screenshot
    // Metadata for the frontend to show while/after generation
    title: { type: String },
    description: { type: String },
    h1: { type: String },
    canonical: { type: String },
    brandAssets: {
        logo: { type: String },
        favicon: { type: String },
        appleIcon: { type: String },
        ogImage: { type: String }
    },
    status: { type: String, default: "completed" },
    createdAt: { type: Date, default: () => new Date() },
    updatedAt: { type: Date, default: () => new Date() },
}, { collection: "stylemd_runs", strict: false });
exports.StyleMdRun = mongoose_1.default.models["StyleMdRun"] || mongoose_1.default.model("StyleMdRun", StyleMdRunSchema);
