"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScrapedData = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
// ---------------------------------------------------------------------------
// scraped_data collection — single source of truth for scraped page data.
// images[] is the ONLY image store; base64 screenshot is always images[0].
// Legacy fields (screenshot, screenshotUrl) are intentionally absent.
// ---------------------------------------------------------------------------
const ScrapedSchema = new mongoose_1.default.Schema({
    url: { type: String, required: true, unique: true, index: true },
    title: { type: String, default: null },
    description: { type: String, default: null },
    h1: { type: String, default: null },
    canonical: { type: String, default: null },
    images: { type: [String], default: [] },
    brandAssets: {
        logo: { type: String },
        favicon: { type: String },
        appleIcon: { type: String },
        ogImage: { type: String }
    },
    contentText: { type: String, default: null },
    rawHtml: { type: String, default: null },
    createdAt: { type: Date, default: () => new Date() },
    updatedAt: { type: Date, default: () => new Date() },
}, { collection: "scraped_data", strict: false });
exports.ScrapedData = mongoose_1.default.models["ScrapedData"] || mongoose_1.default.model("ScrapedData", ScrapedSchema);
