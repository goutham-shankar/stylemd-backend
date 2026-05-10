"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStyleMdRunsBaseDir = getStyleMdRunsBaseDir;
exports.getStyleMdRunDir = getStyleMdRunDir;
exports.ensureStyleMdRunDir = ensureStyleMdRunDir;
exports.writeStyleMdJson = writeStyleMdJson;
exports.writeStyleMdText = writeStyleMdText;
exports.writeStyleMdImage = writeStyleMdImage;
exports.writeStyleMdBinary = writeStyleMdBinary;
exports.appendStyleMdLogLine = appendStyleMdLogLine;
exports.persistStyleMdState = persistStyleMdState;
exports.persistStyleMdSummary = persistStyleMdSummary;
exports.readStyleMdSummary = readStyleMdSummary;
exports.readStyleMdState = readStyleMdState;
exports.listStyleMdRunIdsFromDisk = listStyleMdRunIdsFromDisk;
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
function baseDir() {
    return (0, node_path_1.join)(process.cwd(), ".playground", "stylemd-artifact-runs");
}
function getStyleMdRunsBaseDir() {
    return baseDir();
}
function getStyleMdRunDir(runId) {
    return (0, node_path_1.join)(baseDir(), runId);
}
async function ensureStyleMdRunDir(runId) {
    const dir = getStyleMdRunDir(runId);
    await (0, promises_1.mkdir)(dir, { recursive: true });
    return dir;
}
async function writeArtifactFile(runId, relativeName, data, kind) {
    const runDir = await ensureStyleMdRunDir(runId);
    const filePath = (0, node_path_1.join)(runDir, relativeName);
    await (0, promises_1.mkdir)((0, node_path_1.dirname)(filePath), { recursive: true });
    await (0, promises_1.writeFile)(filePath, data);
    const fileStat = await (0, promises_1.stat)(filePath);
    return {
        name: relativeName,
        path: filePath,
        kind,
        sizeBytes: fileStat.size,
    };
}
async function writeStyleMdJson(runId, relativeName, payload) {
    const content = `${JSON.stringify(payload, null, 2)}\n`;
    return writeArtifactFile(runId, relativeName, content, "json");
}
async function writeStyleMdText(runId, relativeName, content, kind) {
    return writeArtifactFile(runId, relativeName, content, kind);
}
async function writeStyleMdImage(runId, relativeName, imageBuffer) {
    return writeArtifactFile(runId, relativeName, imageBuffer, "image");
}
async function writeStyleMdBinary(runId, relativeName, buffer) {
    return writeArtifactFile(runId, relativeName, buffer, "binary");
}
async function appendStyleMdLogLine(runId, payload) {
    const runDir = await ensureStyleMdRunDir(runId);
    const filePath = (0, node_path_1.join)(runDir, "logs", "events.ndjson");
    await (0, promises_1.mkdir)((0, node_path_1.dirname)(filePath), { recursive: true });
    const line = `${JSON.stringify(payload)}\n`;
    await (0, promises_1.appendFile)(filePath, line, "utf8");
}
async function persistStyleMdState(runId, state) {
    return writeStyleMdJson(runId, "state.json", state);
}
async function persistStyleMdSummary(runId, summary) {
    return writeStyleMdJson(runId, "summary.json", summary);
}
async function readStyleMdSummary(runId) {
    try {
        const path = (0, node_path_1.join)(getStyleMdRunDir(runId), "summary.json");
        const content = await (0, promises_1.readFile)(path, "utf8");
        return JSON.parse(content);
    }
    catch {
        return null;
    }
}
async function readStyleMdState(runId) {
    try {
        const path = (0, node_path_1.join)(getStyleMdRunDir(runId), "state.json");
        const content = await (0, promises_1.readFile)(path, "utf8");
        return JSON.parse(content);
    }
    catch {
        return null;
    }
}
async function listStyleMdRunIdsFromDisk() {
    try {
        const entries = await (0, promises_1.readdir)(baseDir(), { withFileTypes: true });
        return entries
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name)
            .sort();
    }
    catch {
        return [];
    }
}
