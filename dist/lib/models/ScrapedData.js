"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const ScrapedSchema = new mongoose_1.default.Schema({
    url: { type: String, required: true, unique: true, index: true },
    title: { type: String },
    description: { type: String },
    h1: { type: String },
    canonical: { type: String },
    images: { type: [String], default: [] },
    contentText: { type: String },
    rawHtml: { type: String },
    createdAt: { type: Date, default: () => new Date() },
}, { collection: 'scraped_data' });
exports.default = mongoose_1.default.models.ScrapedData || mongoose_1.default.model('ScrapedData', ScrapedSchema);
