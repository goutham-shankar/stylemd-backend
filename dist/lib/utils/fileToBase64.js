"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fileToBase64 = fileToBase64;
exports.bufferToBase64 = bufferToBase64;
exports.isBase64DataUrl = isBase64DataUrl;
exports.extractBase64Content = extractBase64Content;
const promises_1 = require("node:fs/promises");
/**
 * Reads a file and converts it to a base64 data URL
 * @param filePath - Path to the file
 * @param mimeType - MIME type of the file (default: 'image/png')
 * @returns Base64 data URL in format: data:image/png;base64,...
 * @throws Error if file cannot be read
 */
async function fileToBase64(filePath, mimeType = "image/png") {
    try {
        const buffer = await (0, promises_1.readFile)(filePath);
        const base64 = buffer.toString("base64");
        return `data:${mimeType};base64,${base64}`;
    }
    catch (error) {
        throw new Error(`Failed to read file ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
}
/**
 * Converts a buffer to a base64 data URL
 * @param buffer - Buffer to convert
 * @param mimeType - MIME type (default: 'image/png')
 * @returns Base64 data URL
 */
function bufferToBase64(buffer, mimeType = "image/png") {
    const base64 = buffer.toString("base64");
    return `data:${mimeType};base64,${base64}`;
}
/**
 * Checks if a string is a valid base64 data URL
 * @param str - String to check
 * @returns true if valid base64 data URL
 */
function isBase64DataUrl(str) {
    return /^data:image\/[a-z]+;base64,/.test(str);
}
/**
 * Extracts base64 content from a data URL (removes the "data:image/png;base64," prefix)
 * @param dataUrl - Base64 data URL
 * @returns Just the base64 content
 */
function extractBase64Content(dataUrl) {
    return dataUrl.replace(/^data:image\/[a-z]+;base64,/, "");
}
