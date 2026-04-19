import { readFile, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getStyleMdRunDir } from "@/lib/stylemd-artifacts/artifacts";

export const runtime = "nodejs";

const querySchema = z.object({
  runId: z.string().min(1),
  path: z.string().min(1),
  mode: z.enum(["preview", "raw"]).default("preview"),
});

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const TEXT_EXTENSIONS = new Set([".json", ".txt", ".md", ".html", ".css", ".log", ".ndjson", ".js", ".ts"]);
const PREVIEW_TEXT_MAX_CHARS = 250_000;

function guessMimeType(filePath: string): string {
  const extension = extname(filePath).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  if (extension === ".woff2") return "font/woff2";
  if (extension === ".woff") return "font/woff";
  if (extension === ".ttf") return "font/ttf";
  if (extension === ".otf") return "font/otf";
  if (extension === ".eot") return "application/vnd.ms-fontobject";
  if (extension === ".json" || extension === ".ndjson") return "application/json; charset=utf-8";
  if (extension === ".md" || extension === ".txt" || extension === ".log") return "text/plain; charset=utf-8";
  if (extension === ".html") return "text/html; charset=utf-8";
  if (extension === ".css") return "text/css; charset=utf-8";
  return "application/octet-stream";
}

function resolveArtifactPath(runId: string, requestedPath: string): string {
  const runDir = getStyleMdRunDir(runId);
  const resolvedPath = isAbsolute(requestedPath) ? resolve(requestedPath) : resolve(runDir, requestedPath);
  const rel = relative(runDir, resolvedPath);
  if (rel === ".." || rel.startsWith(`..${sep}`)) {
    throw new Error("Artifact path is outside run directory.");
  }
  return resolvedPath;
}

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const parsed = querySchema.parse({
      runId: url.searchParams.get("runId"),
      path: url.searchParams.get("path"),
      mode: url.searchParams.get("mode") ?? "preview",
    });

    const artifactPath = resolveArtifactPath(parsed.runId, parsed.path);
    const fileStat = await stat(artifactPath);
    if (!fileStat.isFile()) {
      return NextResponse.json({ ok: false, error: "Artifact path must point to a file." }, { status: 400 });
    }

    const extension = extname(artifactPath).toLowerCase();
    const mimeType = guessMimeType(artifactPath);

    if (parsed.mode === "raw") {
      const buffer = await readFile(artifactPath);
      return new Response(buffer, {
        headers: {
          "Content-Type": mimeType,
          "Cache-Control": "no-store",
        },
      });
    }

    if (IMAGE_EXTENSIONS.has(extension)) {
      const rawUrl = `/api/stylemd-artifacts/artifact?runId=${encodeURIComponent(parsed.runId)}&path=${encodeURIComponent(artifactPath)}&mode=raw`;
      return NextResponse.json({
        ok: true,
        previewType: "image",
        rawUrl,
        mimeType,
      });
    }

    if (TEXT_EXTENSIONS.has(extension)) {
      const rawText = await readFile(artifactPath, "utf8");
      const truncated = rawText.length > PREVIEW_TEXT_MAX_CHARS;
      const content = truncated
        ? `${rawText.slice(0, PREVIEW_TEXT_MAX_CHARS)}\n...[truncated preview]`
        : rawText;
      return NextResponse.json({
        ok: true,
        previewType: "text",
        mimeType,
        truncated,
        content,
      });
    }

    return NextResponse.json({
      ok: true,
      previewType: "unsupported",
      mimeType,
      message: "Preview is not available for this artifact type.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
