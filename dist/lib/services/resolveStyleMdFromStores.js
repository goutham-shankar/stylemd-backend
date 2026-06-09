"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveStyleMdForRunDoc = resolveStyleMdForRunDoc;
const ScrapedData_1 = require("../../backend/src/models/ScrapedData");
const pageUrlCanonical_1 = require("../../lib/services/pageUrlCanonical");
const styleMarkdownSanitize_1 = require("../../lib/services/styleMarkdownSanitize");
/**
 * Prefer `stylemd_runs.styleMd`; if empty, mirror `scraped_data.contentText` (URL variants).
 */
async function resolveStyleMdForRunDoc(doc) {
    const primary = doc.styleMd?.trim() ?? "";
    if (primary)
        return (0, styleMarkdownSanitize_1.stripLeadingModelPreamble)(primary);
    const urls = (0, pageUrlCanonical_1.pageUrlVariantsForLookup)(doc.url);
    const scraped = await ScrapedData_1.ScrapedData.findOne({
        url: { $in: urls },
        contentText: { $nin: [null, ""] },
    })
        .sort({ createdAt: -1 })
        .lean()
        .catch(() => null);
    const fallback = scraped?.contentText?.trim() ?? "";
    return (0, styleMarkdownSanitize_1.stripLeadingModelPreamble)(fallback || "");
}
