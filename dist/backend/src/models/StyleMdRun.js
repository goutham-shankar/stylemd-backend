"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.StyleMdRun = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const StyleMdRunSchema = new mongoose_1.default.Schema({
    url: { type: String, required: true, unique: true, index: true },
    slug: { type: String, unique: true, index: true },
    provider: { type: String, default: "kimi" },
    model: { type: String },
    runId: { type: String, index: true },
    styleMd: { type: String },
    screenshotUrl: { type: String },
    screenshot: { type: String },
    status: { type: String, default: "completed" },
    createdAt: { type: Date, default: () => new Date() },
}, { collection: "stylemd_runs" });
exports.StyleMdRun = mongoose_1.default.models["StyleMdRun"] || mongoose_1.default.model("StyleMdRun", StyleMdRunSchema);
