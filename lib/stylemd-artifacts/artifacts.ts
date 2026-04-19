import { appendFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { StyleMdArtifactKind, StyleMdArtifactRecord, StyleMdRunState, StyleMdRunSummary } from "@/lib/stylemd-artifacts/types";

function baseDir(): string {
  return join(process.cwd(), ".playground", "stylemd-artifact-runs");
}

export function getStyleMdRunsBaseDir(): string {
  return baseDir();
}

export function getStyleMdRunDir(runId: string): string {
  return join(baseDir(), runId);
}

export async function ensureStyleMdRunDir(runId: string): Promise<string> {
  const dir = getStyleMdRunDir(runId);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function writeArtifactFile(
  runId: string,
  relativeName: string,
  data: string | Uint8Array,
  kind: StyleMdArtifactKind,
): Promise<StyleMdArtifactRecord> {
  const runDir = await ensureStyleMdRunDir(runId);
  const filePath = join(runDir, relativeName);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, data);
  const fileStat = await stat(filePath);

  return {
    name: relativeName,
    path: filePath,
    kind,
    sizeBytes: fileStat.size,
  };
}

export async function writeStyleMdJson(
  runId: string,
  relativeName: string,
  payload: unknown,
): Promise<StyleMdArtifactRecord> {
  const content = `${JSON.stringify(payload, null, 2)}\n`;
  return writeArtifactFile(runId, relativeName, content, "json");
}

export async function writeStyleMdText(
  runId: string,
  relativeName: string,
  content: string,
  kind: Exclude<StyleMdArtifactKind, "json" | "image">,
): Promise<StyleMdArtifactRecord> {
  return writeArtifactFile(runId, relativeName, content, kind);
}

export async function writeStyleMdImage(
  runId: string,
  relativeName: string,
  imageBuffer: Buffer,
): Promise<StyleMdArtifactRecord> {
  return writeArtifactFile(runId, relativeName, imageBuffer, "image");
}

export async function writeStyleMdBinary(
  runId: string,
  relativeName: string,
  buffer: Uint8Array,
): Promise<StyleMdArtifactRecord> {
  return writeArtifactFile(runId, relativeName, buffer, "binary");
}

export async function appendStyleMdLogLine(
  runId: string,
  payload: unknown,
): Promise<void> {
  const runDir = await ensureStyleMdRunDir(runId);
  const filePath = join(runDir, "logs", "events.ndjson");
  await mkdir(dirname(filePath), { recursive: true });
  const line = `${JSON.stringify(payload)}\n`;
  await appendFile(filePath, line, "utf8");
}

export async function persistStyleMdState(
  runId: string,
  state: StyleMdRunState,
): Promise<StyleMdArtifactRecord> {
  return writeStyleMdJson(runId, "state.json", state);
}

export async function persistStyleMdSummary(
  runId: string,
  summary: StyleMdRunSummary,
): Promise<StyleMdArtifactRecord> {
  return writeStyleMdJson(runId, "summary.json", summary);
}

export async function readStyleMdSummary(runId: string): Promise<StyleMdRunSummary | null> {
  try {
    const path = join(getStyleMdRunDir(runId), "summary.json");
    const content = await readFile(path, "utf8");
    return JSON.parse(content) as StyleMdRunSummary;
  } catch {
    return null;
  }
}

export async function readStyleMdState(runId: string): Promise<StyleMdRunState | null> {
  try {
    const path = join(getStyleMdRunDir(runId), "state.json");
    const content = await readFile(path, "utf8");
    return JSON.parse(content) as StyleMdRunState;
  } catch {
    return null;
  }
}

export async function listStyleMdRunIdsFromDisk(): Promise<string[]> {
  try {
    const entries = await readdir(baseDir(), { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}
