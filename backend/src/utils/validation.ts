// Matches the pattern produced by runId() in simplifiedPipeline.ts
const RUN_ID_RE = /^stylemd_\d+_[a-z0-9]+$/;

/**
 * Validate that a runId is safe to use in filesystem paths.
 * Throws if the value contains path-traversal characters or doesn't match the expected pattern.
 */
export function assertSafeRunId(runId: unknown): asserts runId is string {
  if (typeof runId !== "string" || !RUN_ID_RE.test(runId)) {
    throw Object.assign(new Error("Invalid runId."), { statusCode: 400 });
  }
}

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
