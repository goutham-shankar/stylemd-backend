"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getArtifact = getArtifact;
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const zod_1 = require("zod");
const artifacts_1 = require("../../../lib/stylemd-artifacts/artifacts");
const querySchema = zod_1.z.object({
    runId: zod_1.z.string().min(1),
    path: zod_1.z.string().min(1),
    mode: zod_1.z.enum(["preview", "raw"]).default("preview"),
});
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const TEXT_EXTENSIONS = new Set([".json", ".txt", ".md", ".html", ".css", ".log", ".ndjson", ".js", ".ts"]);
const PREVIEW_TEXT_MAX_CHARS = 250000;
function guessMimeType(filePath) {
    const ext = (0, node_path_1.extname)(filePath).toLowerCase();
    const map = {
        ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".webp": "image/webp", ".gif": "image/gif",
        ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf",
        ".json": "application/json", ".md": "text/plain", ".txt": "text/plain",
        ".html": "text/html", ".css": "text/css"
    };
    return map[ext] ?? "application/octet-stream";
}
function resolveArtifactPath(runId, requestedPath) {
    const runDir = (0, artifacts_1.getStyleMdRunDir)(runId);
    const resolvedPath = (0, node_path_1.isAbsolute)(requestedPath) ? (0, node_path_1.resolve)(requestedPath) : (0, node_path_1.resolve)(runDir, requestedPath);
    const rel = (0, node_path_1.relative)(runDir, resolvedPath);
    if (rel === ".." || rel.startsWith(`..${node_path_1.sep}`))
        throw new Error("Path outside run directory.");
    return resolvedPath;
}
async function getArtifact(req, res) {
    try {
        const parsed = querySchema.parse({ runId: req.query["runId"], path: req.query["path"], mode: req.query["mode"] ?? "preview" });
        const artifactPath = resolveArtifactPath(parsed.runId, parsed.path);
        const fileStat = await (0, promises_1.stat)(artifactPath);
        if (!fileStat.isFile()) {
            res.status(400).json({ ok: false, error: "Must be a file." });
            return;
        }
        const ext = (0, node_path_1.extname)(artifactPath).toLowerCase();
        const mimeType = guessMimeType(artifactPath);
        if (parsed.mode === "raw") {
            const buffer = await (0, promises_1.readFile)(artifactPath);
            res.setHeader("Content-Type", mimeType).setHeader("Cache-Control", "no-store").send(buffer);
            return;
        }
        if (IMAGE_EXTENSIONS.has(ext)) {
            const rawUrl = `/api/stylemd-artifacts/artifact?runId=${encodeURIComponent(parsed.runId)}&path=${encodeURIComponent(parsed.path)}&mode=raw`;
            res.json({ ok: true, data: { previewType: "image", rawUrl, mimeType } });
            return;
        }
        if (TEXT_EXTENSIONS.has(ext)) {
            const rawText = await (0, promises_1.readFile)(artifactPath, "utf8");
            const truncated = rawText.length > PREVIEW_TEXT_MAX_CHARS;
            const content = truncated ? `${rawText.slice(0, PREVIEW_TEXT_MAX_CHARS)}\n...[truncated]` : rawText;
            res.json({ ok: true, data: { previewType: "text", mimeType, truncated, content } });
            return;
        }
        res.json({ ok: true, data: { previewType: "unsupported", mimeType, message: "Preview not available." } });
    }
    catch (err) {
        res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
}
