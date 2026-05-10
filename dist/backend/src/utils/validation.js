"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isValidScrapedRecord = isValidScrapedRecord;
/**
 * STRICT validity check for scraped records.
 * Ensures we don't cache poisoned or partial data.
 * Updated to be less fragile while maintaining quality.
 */
function isValidScrapedRecord(doc) {
    return (doc &&
        typeof doc.url === "string" &&
        Array.isArray(doc.images) &&
        doc.images.length > 0 &&
        doc.images.every((img) => typeof img === "string" && img.startsWith("data:image")) &&
        typeof doc.contentText === "string" &&
        doc.contentText.trim().length > 0 &&
        typeof doc.rawHtml === "string" &&
        doc.rawHtml.toLowerCase().includes("<html"));
}
