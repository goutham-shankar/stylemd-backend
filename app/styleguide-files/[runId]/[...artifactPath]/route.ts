import { readFile, stat } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";
import { NextResponse } from "next/server";
import { getStyleMdRunDir } from "@/lib/stylemd-artifacts/artifacts";

export const runtime = "nodejs";

function guessMimeType(filePath: string): string {
  const extension = extname(filePath).toLowerCase();
  if (extension === ".html") return "text/html; charset=utf-8";
  if (extension === ".css") return "text/css; charset=utf-8";
  if (extension === ".js") return "application/javascript; charset=utf-8";
  if (extension === ".json" || extension === ".ndjson") return "application/json; charset=utf-8";
  if (extension === ".md" || extension === ".txt" || extension === ".log") return "text/plain; charset=utf-8";
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  if (extension === ".svg") return "image/svg+xml";
  if (extension === ".woff2") return "font/woff2";
  if (extension === ".woff") return "font/woff";
  if (extension === ".ttf") return "font/ttf";
  if (extension === ".otf") return "font/otf";
  if (extension === ".eot") return "application/vnd.ms-fontobject";
  return "application/octet-stream";
}

function resolveRunArtifactPath(input: {
  runId: string;
  artifactPath: string[];
}): string {
  const runDir = getStyleMdRunDir(input.runId);
  const requestedPath = input.artifactPath.join("/");
  const resolvedPath = resolve(runDir, requestedPath);
  const rel = relative(runDir, resolvedPath);
  if (rel === ".." || rel.startsWith(`..${sep}`)) {
    throw new Error("Artifact path is outside run directory.");
  }
  return resolvedPath;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ runId: string; artifactPath: string[] }> },
): Promise<Response> {
  try {
    const params = await context.params;
    if (!params.artifactPath || params.artifactPath.length === 0) {
      return NextResponse.json({ ok: false, error: "Artifact path is required." }, { status: 400 });
    }

    const artifactPath = resolveRunArtifactPath({
      runId: params.runId,
      artifactPath: params.artifactPath,
    });
    const fileStat = await stat(artifactPath);
    if (!fileStat.isFile()) {
      return NextResponse.json({ ok: false, error: "Artifact path must point to a file." }, { status: 400 });
    }

    const buffer = await readFile(artifactPath);
    return new Response(buffer, {
      headers: {
        "Content-Type": guessMimeType(artifactPath),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return NextResponse.json({ ok: false, error: "Artifact not found." }, { status: 404 });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
