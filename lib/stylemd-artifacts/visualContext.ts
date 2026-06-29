import { readFile, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import sharp from "sharp";
import { runKimiVisionContextQuery } from "@/lib/kimi/styleguide";
import type { KimiUserContentPart } from "@/lib/kimi/client";
import { createEmptyKimiTokenUsage, type KimiTokenUsage } from "@/lib/services/kimiUsage";
import { getStyleMdRunDir, writeStyleMdImage, writeStyleMdJson } from "@/lib/stylemd-artifacts/artifacts";
import { errorToMessage, nowIso, runIdLog } from "@/lib/stylemd-artifacts/helpers";
import type {
  StyleMdArtifactRecord,
  StyleMdCuratedManifest,
  StyleMdResponsiveHoverEvidence,
} from "@/lib/stylemd-artifacts/types";
import type { StyleMdRuntimeConfig } from "@/lib/stylemd-artifacts/provider";

export type StyleMdDesignMdMode = "baseline" | "vision";

export type StyleMdVisualContextImage = {
  label: string;
  path: string;
  source: "desktop_above_fold" | "full_page" | "mobile_responsive" | "component";
  mimeType: string;
  width?: number;
  height?: number;
};

export type StyleMdVisualContext = {
  run_id: string;
  url: string;
  generated_at: string;
  mode: "vision";
  status: "completed" | "failed" | "skipped";
  images: StyleMdVisualContextImage[];
  summary: Record<string, unknown> | null;
  raw_response?: string;
  error?: string;
};

export type VisualContextQueryInput = {
  runId: string;
  runtime: StyleMdRuntimeConfig;
  systemPrompt: string;
  content: KimiUserContentPart[];
  signal: AbortSignal;
  queryLabel?: string;
  onTokenUsage?: (inputTokens: number, outputTokens: number) => void;
};

export type VisualContextQuery = (input: VisualContextQueryInput) => Promise<string>;

export type RunStyleMdVisualContextResult = {
  context: StyleMdVisualContext;
  artifacts: StyleMdArtifactRecord[];
  query: KimiTokenUsage;
};

type ImageCandidate = StyleMdVisualContextImage & {
  absolutePath: string;
};

function toRunRelative(runDir: string, path: string): string {
  return relative(runDir, path).split("\\").join("/");
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function mimeTypeForPath(path: string): string {
  const ext = extname(path).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/png";
}

async function imageDataUrl(path: string, mimeType: string): Promise<string> {
  const buffer = await readFile(path);
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced ?? trimmed;
  try {
    const parsed = JSON.parse(candidate);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(candidate.slice(start, end + 1));
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? parsed as Record<string, unknown>
          : null;
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function buildScreenshotDerivatives(input: {
  runId: string;
  runDir: string;
}): Promise<{
  images: ImageCandidate[];
  artifacts: StyleMdArtifactRecord[];
}> {
  const { runId, runDir } = input;
  const fullScreenshotPath = join(runDir, "full_screenshot.png");
  if (!(await fileExists(fullScreenshotPath))) {
    throw new Error("full_screenshot.png is missing");
  }

  const metadata = await sharp(fullScreenshotPath).metadata();
  const sourceWidth = metadata.width ?? 0;
  const sourceHeight = metadata.height ?? 0;
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error("full_screenshot.png has invalid dimensions");
  }

  const aboveFoldHeight = Math.max(1, Math.min(sourceHeight, 900));
  const aboveFoldBuffer = await sharp(fullScreenshotPath)
    .extract({
      left: 0,
      top: 0,
      width: sourceWidth,
      height: aboveFoldHeight,
    })
    .resize({ width: 1280, withoutEnlargement: true })
    .jpeg({ quality: 78, mozjpeg: true })
    .toBuffer();
  const aboveFoldArtifact = await writeStyleMdImage(
    runId,
    join("styleguide", "visual_context", "desktop_above_fold.jpg"),
    aboveFoldBuffer,
  );

  const fullPageBuffer = await sharp(fullScreenshotPath)
    .resize({ width: 1000, height: 2400, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 74, mozjpeg: true })
    .toBuffer();
  const fullPageArtifact = await writeStyleMdImage(
    runId,
    join("styleguide", "visual_context", "full_page_downsampled.jpg"),
    fullPageBuffer,
  );

  const aboveMeta = await sharp(aboveFoldArtifact.path).metadata();
  const fullMeta = await sharp(fullPageArtifact.path).metadata();

  return {
    artifacts: [aboveFoldArtifact, fullPageArtifact],
    images: [
      {
        label: "desktop above-the-fold screenshot",
        path: toRunRelative(runDir, aboveFoldArtifact.path),
        absolutePath: aboveFoldArtifact.path,
        source: "desktop_above_fold",
        mimeType: "image/jpeg",
        width: aboveMeta.width,
        height: aboveMeta.height,
      },
      {
        label: "downsampled full-page screenshot",
        path: toRunRelative(runDir, fullPageArtifact.path),
        absolutePath: fullPageArtifact.path,
        source: "full_page",
        mimeType: "image/jpeg",
        width: fullMeta.width,
        height: fullMeta.height,
      },
    ],
  };
}

function firstMobileResponsiveScreenshot(input: {
  runDir: string;
  responsiveHoverEvidence: StyleMdResponsiveHoverEvidence | null;
}): ImageCandidate | null {
  const { runDir, responsiveHoverEvidence } = input;
  const mobile = responsiveHoverEvidence?.breakpoints.find((breakpoint) => breakpoint.name === "mobile");
  if (!mobile) return null;

  for (const unit of mobile.units) {
    for (const component of unit.components) {
      const rel = component.default_screenshot ?? component.hover_screenshot;
      if (!rel) continue;
      const absolutePath = join(runDir, rel);
      return {
        label: `mobile responsive component screenshot (${unit.unit_id})`,
        path: rel,
        absolutePath,
        source: "mobile_responsive",
        mimeType: mimeTypeForPath(absolutePath),
      };
    }
  }
  return null;
}

async function representativeComponentScreenshots(input: {
  runDir: string;
  curatedManifest: StyleMdCuratedManifest;
  existingPaths: Set<string>;
}): Promise<ImageCandidate[]> {
  const { runDir, curatedManifest, existingPaths } = input;
  const candidates = curatedManifest.units
    .flatMap((unit) => unit.components.map((component) => ({ unit, component })))
    .sort((a, b) => a.component.rect.top - b.component.rect.top);

  const images: ImageCandidate[] = [];
  for (const { unit, component } of candidates) {
    if (images.length >= 4) break;
    if (!component.screenshotPath || existingPaths.has(component.screenshotPath)) continue;
    if (!(await fileExists(component.screenshotPath))) continue;
    existingPaths.add(component.screenshotPath);
    images.push({
      label: `${unit.study_label} component screenshot`,
      path: toRunRelative(runDir, component.screenshotPath),
      absolutePath: component.screenshotPath,
      source: "component",
      mimeType: mimeTypeForPath(component.screenshotPath),
    });
  }
  return images;
}

export function buildVisualContextSystemPrompt(): string {
  return [
    "You analyze website screenshots to support a design-system markdown generator.",
    "Return only compact JSON. No markdown fences unless unavoidable.",
    "Do not invent brand facts, product claims, or implementation details.",
    "Focus on visual style, composition, usage patterns, and page-building guidance.",
  ].join("\n");
}

export function buildVisualContextInstruction(images: StyleMdVisualContextImage[]): string {
  return [
    "Inspect the attached screenshots and summarize visual context for a DESIGN.md generator.",
    "",
    "Images in order:",
    ...images.map((image, index) => `${index + 1}. ${image.label} (${image.source}, ${image.path})`),
    "",
    "Return JSON with exactly these keys:",
    "{",
    "  \"design_personality\": \"short description of mood, polish, density, and visual energy\",",
    "  \"composition_rules\": [\"page assembly rule\", \"section rhythm rule\"],",
    "  \"color_usage\": [\"where key colors appear and how they are used\"],",
    "  \"typography_usage\": [\"where display/body/ui type is used\"],",
    "  \"imagery_media\": [\"image treatment, crop/framing, media role\"],",
    "  \"component_scenarios\": [\"button/card/nav/form usage patterns visible in screenshots\"],",
    "  \"responsive_notes\": [\"mobile or responsive observations if visible\"],",
    "  \"page_recipes\": [\"homepage/landing/product/editorial recipe guidance if inferable\"],",
    "  \"dos\": [\"style-preserving instruction\"],",
    "  \"donts\": [\"style-breaking choice to avoid\"]",
    "}",
  ].join("\n");
}

async function defaultVisualContextQuery(input: VisualContextQueryInput): Promise<string> {
  return runKimiVisionContextQuery(input);
}

export async function runStyleMdVisualContext(input: {
  runId: string;
  url: string;
  runtime: StyleMdRuntimeConfig;
  curatedManifest: StyleMdCuratedManifest;
  responsiveHoverEvidence: StyleMdResponsiveHoverEvidence | null;
  signal: AbortSignal;
  runVisualContextQuery?: VisualContextQuery;
}): Promise<RunStyleMdVisualContextResult> {
  const { runId, url, runtime, curatedManifest, responsiveHoverEvidence, signal } = input;
  const runDir = getStyleMdRunDir(runId);
  const artifacts: StyleMdArtifactRecord[] = [];
  let query = createEmptyKimiTokenUsage();

  try {
    const derivativeResult = await buildScreenshotDerivatives({ runId, runDir });
    artifacts.push(...derivativeResult.artifacts);

    const existingPaths = new Set(derivativeResult.images.map((image) => image.absolutePath));
    const mobileScreenshot = firstMobileResponsiveScreenshot({ runDir, responsiveHoverEvidence });
    const mobileImages: ImageCandidate[] = [];
    if (mobileScreenshot && await fileExists(mobileScreenshot.absolutePath)) {
      existingPaths.add(mobileScreenshot.absolutePath);
      mobileImages.push(mobileScreenshot);
    }
    const componentImages = await representativeComponentScreenshots({
      runDir,
      curatedManifest,
      existingPaths,
    });

    const imageCandidates = [
      ...derivativeResult.images,
      ...mobileImages,
      ...componentImages,
    ].slice(0, 7);

    const publicImages: StyleMdVisualContextImage[] = imageCandidates.map(({ absolutePath, ...image }) => image);
    if (publicImages.length === 0) {
      throw new Error("no visual context images available");
    }

    const content: KimiUserContentPart[] = [];
    for (const [index, image] of imageCandidates.entries()) {
      content.push({
        type: "text",
        text: `Image ${index + 1}: ${image.label} (${image.source}).`,
      });
      content.push({
        type: "image_url",
        image_url: {
          url: await imageDataUrl(image.absolutePath, image.mimeType),
        },
      });
    }
    content.push({
      type: "text",
      text: buildVisualContextInstruction(publicImages),
    });

    let latestInputTokens = 0;
    let latestOutputTokens = 0;
    const rawResponse = await (input.runVisualContextQuery ?? defaultVisualContextQuery)({
      runId,
      runtime,
      systemPrompt: buildVisualContextSystemPrompt(),
      content,
      signal,
      queryLabel: "styleguide-visual-context",
      onTokenUsage: (inputTokens, outputTokens) => {
        latestInputTokens = inputTokens;
        latestOutputTokens = outputTokens;
      },
    });
    query = {
      inputTokens: latestInputTokens,
      outputTokens: latestOutputTokens,
      totalTokens: latestInputTokens + latestOutputTokens,
    };

    const parsed = extractJsonObject(rawResponse);
    const context: StyleMdVisualContext = {
      run_id: runId,
      url,
      generated_at: nowIso(),
      mode: "vision",
      status: parsed ? "completed" : "failed",
      images: publicImages,
      summary: parsed,
      raw_response: rawResponse.slice(0, 20_000),
      ...(parsed ? {} : { error: "visual context response was not valid JSON" }),
    };

    const artifact = await writeStyleMdJson(runId, join("styleguide", "visual_context.json"), context);
    artifacts.push(artifact);
    return { context, artifacts, query };
  } catch (error) {
    const message = errorToMessage(error);
    runIdLog(runId, `[VISUAL_CONTEXT] ${message}`, "warn");
    const context: StyleMdVisualContext = {
      run_id: runId,
      url,
      generated_at: nowIso(),
      mode: "vision",
      status: "failed",
      images: [],
      summary: null,
      error: message,
    };
    const artifact = await writeStyleMdJson(runId, join("styleguide", "visual_context.json"), context);
    artifacts.push(artifact);
    return { context, artifacts, query };
  }
}
