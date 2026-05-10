import { readFile, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import type { Request, Response } from "express";
import { z } from "zod";
import { getStyleMdRunDir } from "@/lib/stylemd-artifacts/artifacts";
import { assertSafeRunId } from "../utils/validation";

const querySchema = z.object({
  runId: z.string().min(1),
  path: z.string().min(1),
  mode: z.enum(["preview", "raw"]).default("preview"),
});

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const TEXT_EXTENSIONS = new Set([".json", ".txt", ".md", ".html", ".css", ".log", ".ndjson", ".js", ".ts"]);
const PREVIEW_TEXT_MAX_CHARS = 250_000;

function guessMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".webp": "image/webp", ".gif": "image/gif",
    ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf",
    ".json": "application/json", ".md": "text/plain", ".txt": "text/plain",
    ".html": "text/html", ".css": "text/css"
  };
  return map[ext] ?? "application/octet-stream";
}

function resolveArtifactPath(runId: string, requestedPath: string): string {
  const runDir = getStyleMdRunDir(runId);
  const resolvedPath = isAbsolute(requestedPath) ? resolve(requestedPath) : resolve(runDir, requestedPath);
  const rel = relative(runDir, resolvedPath);
  if (rel === ".." || rel.startsWith(`..${sep}`)) throw new Error("Path outside run directory.");
  return resolvedPath;
}

export async function getArtifact(req: Request, res: Response): Promise<void> {
  try {
    const parsed = querySchema.parse({ runId: req.query["runId"], path: req.query["path"], mode: req.query["mode"] ?? "preview" });
    assertSafeRunId(parsed.runId);
    const artifactPath = resolveArtifactPath(parsed.runId, parsed.path);
    const fileStat = await stat(artifactPath);
    if (!fileStat.isFile()) {
      res.status(400).json({ ok: false, error: "Must be a file." });
      return;
    }
    const ext = extname(artifactPath).toLowerCase();
    const mimeType = guessMimeType(artifactPath);

    if (parsed.mode === "raw") {
      const buffer = await readFile(artifactPath);
      res.setHeader("Content-Type", mimeType).setHeader("Cache-Control", "no-store").send(buffer);
      return;
    }

    if (IMAGE_EXTENSIONS.has(ext)) {
      const rawUrl = `/api/stylemd-artifacts/artifact?runId=${encodeURIComponent(parsed.runId)}&path=${encodeURIComponent(parsed.path)}&mode=raw`;
      res.json({ ok: true, data: { previewType: "image", rawUrl, mimeType } });
      return;
    }

    if (TEXT_EXTENSIONS.has(ext)) {
      const rawText = await readFile(artifactPath, "utf8");
      const truncated = rawText.length > PREVIEW_TEXT_MAX_CHARS;
      const content = truncated ? `${rawText.slice(0, PREVIEW_TEXT_MAX_CHARS)}\n...[truncated]` : rawText;
      res.json({ ok: true, data: { previewType: "text", mimeType, truncated, content } });
      return;
    }

    res.json({ ok: true, data: { previewType: "unsupported", mimeType, message: "Preview not available." } });
  } catch (err) {
    res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}
