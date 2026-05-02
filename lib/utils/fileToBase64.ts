import { readFile } from "node:fs/promises";

/**
 * Reads a file and converts it to a base64 data URL
 * @param filePath - Path to the file
 * @param mimeType - MIME type of the file (default: 'image/png')
 * @returns Base64 data URL in format: data:image/png;base64,...
 * @throws Error if file cannot be read
 */
export async function fileToBase64(
  filePath: string,
  mimeType: string = "image/png"
): Promise<string> {
  try {
    const buffer = await readFile(filePath);
    const base64 = buffer.toString("base64");
    return `data:${mimeType};base64,${base64}`;
  } catch (error) {
    throw new Error(
      `Failed to read file ${filePath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Converts a buffer to a base64 data URL
 * @param buffer - Buffer to convert
 * @param mimeType - MIME type (default: 'image/png')
 * @returns Base64 data URL
 */
export function bufferToBase64(
  buffer: Buffer,
  mimeType: string = "image/png"
): string {
  const base64 = buffer.toString("base64");
  return `data:${mimeType};base64,${base64}`;
}

/**
 * Checks if a string is a valid base64 data URL
 * @param str - String to check
 * @returns true if valid base64 data URL
 */
export function isBase64DataUrl(str: string): boolean {
  return /^data:image\/[a-z]+;base64,/.test(str);
}

/**
 * Extracts base64 content from a data URL (removes the "data:image/png;base64," prefix)
 * @param dataUrl - Base64 data URL
 * @returns Just the base64 content
 */
export function extractBase64Content(dataUrl: string): string {
  return dataUrl.replace(/^data:image\/[a-z]+;base64,/, "");
}
