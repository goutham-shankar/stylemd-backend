/**
 * STRICT validity check for scraped records.
 * Ensures we don't cache poisoned or partial data.
 * Updated to be less fragile while maintaining quality.
 */
export function isValidScrapedRecord(doc: any): boolean {
  return (
    doc &&
    typeof doc.url === "string" &&
    Array.isArray(doc.images) &&
    doc.images.length > 0 &&
    doc.images.every((img: any) => typeof img === "string" && img.startsWith("data:image")) &&
    typeof doc.contentText === "string" &&
    doc.contentText.trim().length > 0 &&
    typeof doc.rawHtml === "string" &&
    doc.rawHtml.toLowerCase().includes("<html")
  );
}
