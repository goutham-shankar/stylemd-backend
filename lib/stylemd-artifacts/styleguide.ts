import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { queryWithKimiBridge } from "@/lib/kimi/bridge";
import type { HookCallback, SDKMessage } from "@/lib/stylemd-artifacts/sdk-types";
import { chromium } from "playwright";
import { summarizeForLog } from "@/lib/utils/logging";
import { emitEvent } from "@/lib/store/stylemdSessionStore";
import type { PlaygroundEvent } from "@/lib/types/stylemdEvents";
import {
  appendStyleMdLogLine,
  getStyleMdRunDir,
  writeStyleMdJson,
  writeStyleMdText,
} from "@/lib/stylemd-artifacts/artifacts";
import type { KimiTokenUsage } from "@/lib/services/kimiUsage";
import {
  resolveStyleMdRuntimeConfig,
  type StyleMdRuntimeConfig,
} from "@/lib/stylemd-artifacts/provider";
import {
  assertNotAborted,
  errorToMessage,
  getPlaywrightLaunchOptions,
  nowIso,
  runIdLog,
} from "@/lib/stylemd-artifacts/helpers";
import type {
  StyleMdArtifactRecord,
  StyleMdCuratedManifest,
  StyleMdFontManifest,
  StyleMdResponsiveHoverEvidence,
  StyleMdShowcaseResult,
  StyleMdStyleguideResult,
} from "@/lib/stylemd-artifacts/types";

// Token tracking for queries
const tokenUsageMap = new Map<string, { inputTokens: number; outputTokens: number }>();

function storeTokenUsage(runId: string, queryLabel: string, inputTokens: number, outputTokens: number): void {
  const key = `${runId}::${queryLabel}`;
  tokenUsageMap.set(key, { inputTokens, outputTokens });
}

function getTokenUsage(runId: string, queryLabel: string): { inputTokens: number; outputTokens: number; totalTokens: number } {
  const key = `${runId}::${queryLabel}`;
  const usage = tokenUsageMap.get(key) ?? { inputTokens: 0, outputTokens: 0 };
  return { ...usage, totalTokens: usage.inputTokens + usage.outputTokens };
}

type ObservableEventPayload = {
  type: PlaygroundEvent["type"];
  source: PlaygroundEvent["source"];
  [key: string]: unknown;
};

type StageOutput<T> = {
  result: T;
  artifacts: StyleMdArtifactRecord[];
};

type StyleguidePromptInput = {
  run_id: string;
  url: string;
  generated_at: string;
  run_dir: string;
  full_screenshot: string;
  curated_manifest: string;
  evidence_agent: string;
  responsive_hover_evidence: string | null;
  typography_inventory: Array<{
    family: string;
    usage_count: number;
  }>;
  required_typography_families: string[];
  unit_count: number;
  units: Array<{
    unit_id: string;
    type: "single" | "merge";
    study_label: string;
    component_ids: string[];
  }>;
};

type StyleguideAgentEvidence = {
  run_id: string;
  url: string;
  generated_at: string;
  full_screenshot: string;
  curated_manifest: string;
  responsive_hover_evidence: string | null;
  design_token_manifest?: string | null; // NEW
  semantic_structure?: string | null;     // NEW
  unit_count: number;
  units: Array<{
    unit_id: string;
    type: "single" | "merge";
    study_label: string;
    reason: string;
    component_ids: string[];
    components: Array<{
      component_id: string;
      selector: string;
      tag_name: string;
      rect: {
        top: number;
        left: number;
        width: number;
        height: number;
        bottom: number;
      };
      files: {
        screenshot: string;
        metadata: string;
        dom_agent: string;
        styles_agent: string;
        pseudo_agent: string;
        style_tree_agent: string;
      };
      evidence: {
        metadata: {
          children_count: number | null;
        };
        dom_excerpt: string;
        styles: Record<string, string>;
        pseudo: {
          before: Record<string, string>;
        };
        style_tree_head: Array<{
          node_path: string;
          tag_name: string;
          text_sample: string;
          rect: {
            top: number;
            left: number;
            width: number;
            height: number;
            bottom: number;
          } | null;
        }>;
      };
    }>;
  }>;
};

type ShowcasePromptInput = {
  run_id: string;
  url: string;
  generated_at: string;
  style_md: string;
  full_screenshot: string;
  evidence_agent: string;
  typography_inventory: Array<{
    family: string;
    usage_count: number;
  }>;
  required_typography_families: string[];
  font_assets: {
    manifest: string | null;
    local_css: string | null;
  };
  guardrails: {
    disallow_external_http: true;
    disallow_scripts: true;
    static_html_only: true;
  };
};

type ShowcaseSandboxValidation = {
  ok: boolean;
  issues: string[];
  diagnostics: {
    skipped: boolean;
    reason?: string;
    nodeCount: number;
    hasPrimaryContent: boolean;
    bodyTextLength: number;
    pageErrors: string[];
    consoleErrors: string[];
    requestFailures: string[];
  };
};

type RunStyleguideInput = {
  runId: string;
  url: string;
  curatedManifestPath: string;
  curatedManifest: StyleMdCuratedManifest;
  responsiveHoverEvidencePath?: string;
  signal: AbortSignal;
  runtime?: StyleMdRuntimeConfig;
  runClaudeQuery?: ClaudeStyleguideQuery;
};

type RunShowcaseInput = {
  runId: string;
  url: string;
  curatedManifestPath: string;
  curatedManifest: StyleMdCuratedManifest;
  responsiveHoverEvidencePath?: string;
  styleMdPath: string;
  styleMarkdown?: string;
  evidenceAgentPath: string;
  typographyInventoryPath?: string;
  typographyInventory?: Array<{
    family: string;
    usage_count: number;
  }>;
  requiredTypographyFamilies?: string[];
  fontsManifestPath?: string;
  fontsLocalCssPath?: string;
  signal: AbortSignal;
  runtime?: StyleMdRuntimeConfig;
  runClaudeQuery?: ClaudeStyleguideQuery;
};

type ClaudeStyleguideQueryInput = {
  runId: string;
  workspaceDir: string;
  runtime: StyleMdRuntimeConfig;
  stageName?: "styleguide" | "showcase";
  systemPrompt: string;
  prompt: string;
  signal: AbortSignal;
  queryLabel?: string;
};

type ClaudeStyleguideQuery = (input: ClaudeStyleguideQueryInput) => Promise<string>;

const STYLEGUIDE_ALLOWED_TOOLS = ["Read", "Grep", "Glob", "LS"];
const STYLEGUIDE_QUERY_TIMEOUT_MS = 600_000;
const STYLEGUIDE_MAX_READ_BYTES = 350_000;
const DEFAULT_SHOWCASE_REPAIR_PASSES = 6;
const SHOWCASE_REPAIR_PASS_CAP = 12;

const RAW_BLOCKLIST_PATTERNS = [
  ".raw.",
  "/components_manifest.raw.json",
  "/components_manifest.deduped.json",
  "/dom.html",
  "/styles.json",
  "/style_tree.json",
  "/pseudo_styles.json",
  "/css_rule_refs.json",
];

function buildStageTag(runId: string, stageName: string): string {
  return `[stylemd:${runId}:${stageName}]`;
}

function emitObservedStyleMdEvent(
  runId: string,
  event: ObservableEventPayload,
): void {
  const fullEvent = emitEvent(event as Parameters<typeof emitEvent>[0]);
  void appendStyleMdLogLine(runId, fullEvent);
}

export class StyleguideStageError extends Error {
  public readonly artifacts: StyleMdArtifactRecord[];

  public readonly warning: string;

  public readonly query?: KimiTokenUsage & {
    maxTurns: number;
    timeoutMs: number;
    durationMs: number;
    failed: boolean;
    failureReason?: string;
  };

  public constructor(
    message: string,
    warning: string,
    artifacts: StyleMdArtifactRecord[],
    query?: KimiTokenUsage & {
      maxTurns: number;
      timeoutMs: number;
      durationMs: number;
      failed: boolean;
      failureReason?: string;
    },
  ) {
    super(message);
    this.name = "StyleguideStageError";
    this.warning = warning;
    this.artifacts = artifacts;
    this.query = query;
  }
}

function extractAssistantText(message: SDKMessage): string | null {
  if (message.type !== "assistant") {
    return null;
  }
  const body = message.message as { content?: Array<{ type?: string; text?: string }> };
  if (!Array.isArray(body.content)) {
    return null;
  }
  const parts: string[] = [];
  for (const item of body.content) {
    if (item.type === "text" && typeof item.text === "string") {
      parts.push(item.text);
    }
  }
  const merged = parts.join("\n").trim();
  return merged.length > 0 ? merged : null;
}

function extractDeltaText(message: SDKMessage): string | null {
  if (message.type !== "stream_event") {
    return null;
  }
  const event = message.event as {
    type?: string;
    delta?: { type?: string; text?: string };
  };
  if (event?.type !== "content_block_delta") {
    return null;
  }
  if (event.delta?.type !== "text_delta") {
    return null;
  }
  return typeof event.delta.text === "string" ? event.delta.text : null;
}

function truncateForError(value: string, maxChars = 1_000): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxChars)}...[truncated]`;
}

function getResultFailureDetail(message: SDKMessage): string {
  if (message.type !== "result" || !message.is_error) {
    return "";
  }
  if ("errors" in message && Array.isArray(message.errors) && message.errors.length > 0) {
    return truncateForError(message.errors.join("; "));
  }
  if ("result" in message && typeof message.result === "string" && message.result.trim()) {
    return truncateForError(message.result);
  }
  if (typeof message.stop_reason === "string" && message.stop_reason.trim()) {
    return `stop_reason=${message.stop_reason}`;
  }
  return "unknown error result";
}

function toRunRelative(runDir: string, absolutePath: string): string {
  const value = relative(runDir, absolutePath);
  return value.split("\\").join("/");
}

function cleanSnippet(value: string, maxChars: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, maxChars);
}

const GENERIC_FONT_FAMILIES = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "system-ui",
  "emoji",
  "math",
  "fangsong",
  "cursive",
  "fantasy",
  "ui-sans-serif",
  "ui-serif",
  "ui-monospace",
  "ui-rounded",
]);

function parseFontFamilyTokens(value: string): string[] {
  return value
    .split(",")
    .map((token) => stripFontToken(token))
    .filter((token) => token.length > 0);
}

function stripFontToken(token: string): string {
  const trimmed = token.trim();
  if (!trimmed) {
    return "";
  }
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function normalizeFontFamily(token: string): string {
  return stripFontToken(token).replace(/\s+/g, " ").trim();
}

function isGenericFamily(token: string): boolean {
  return GENERIC_FONT_FAMILIES.has(normalizeFontFamily(token).toLowerCase());
}

function buildTypographyInventory(evidence: StyleguideAgentEvidence): Array<{
  family: string;
  usage_count: number;
}> {
  const usage = new Map<string, number>();

  const captureFamilyUsage = (raw: string | undefined): void => {
    if (!raw) {
      return;
    }
    for (const token of parseFontFamilyTokens(raw)) {
      const normalized = normalizeFontFamily(token);
      if (!normalized || isGenericFamily(normalized)) {
        continue;
      }
      usage.set(normalized, (usage.get(normalized) ?? 0) + 1);
    }
  };

  for (const unit of evidence.units) {
    for (const component of unit.components) {
      captureFamilyUsage(component.evidence.styles["font-family"]);
      captureFamilyUsage(component.evidence.pseudo.before["font-family"]);
    }
  }

  return [...usage.entries()]
    .map(([family, usage_count]) => ({ family, usage_count }))
    .sort((a, b) => {
      if (b.usage_count !== a.usage_count) {
        return b.usage_count - a.usage_count;
      }
      return a.family.localeCompare(b.family);
    });
}

function deriveRequiredTypographyFamilies(
  inventory: Array<{
    family: string;
    usage_count: number;
  }>,
): string[] {
  if (inventory.length === 0) {
    return [];
  }

  const topUsage = inventory[0]?.usage_count ?? 0;
  const threshold = Math.max(1, Math.min(topUsage, 2));
  return inventory
    .filter((entry) => entry.usage_count >= threshold)
    .slice(0, 6)
    .map((entry) => entry.family);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function safeReadText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

async function safeReadJson(path: string): Promise<unknown | null> {
  const text = await safeReadText(path);
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function toStringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") {
    return {};
  }
  const output: Record<string, string> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === "string" && item.trim()) {
      output[key] = item;
    }
  }
  return output;
}

function toNumberValue(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function normalizeStyleTreeEntries(value: unknown): Array<{
  node_path: string;
  tag_name: string;
  text_sample: string;
  rect: {
    top: number;
    left: number;
    width: number;
    height: number;
    bottom: number;
  } | null;
}> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .slice(0, 3)
    .map((entry) => (entry && typeof entry === "object" ? entry as Record<string, unknown> : null))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .map((entry) => {
      const rectValue = entry.rect && typeof entry.rect === "object"
        ? {
          top: toNumberValue((entry.rect as Record<string, unknown>).top, 0),
          left: toNumberValue((entry.rect as Record<string, unknown>).left, 0),
          width: toNumberValue((entry.rect as Record<string, unknown>).width, 0),
          height: toNumberValue((entry.rect as Record<string, unknown>).height, 0),
          bottom: toNumberValue((entry.rect as Record<string, unknown>).bottom, 0),
        }
        : null;

      return {
        node_path: typeof entry.nodePath === "string" ? entry.nodePath : "",
        tag_name: typeof entry.tagName === "string" ? entry.tagName : "",
        text_sample: typeof entry.textSample === "string" ? cleanSnippet(entry.textSample, 80) : "",
        rect: rectValue,
      };
    });
}

function collectResponsiveEvidenceScreenshotPaths(
  runDir: string,
  responsiveHoverEvidence: StyleMdResponsiveHoverEvidence | null,
): string[] {
  if (!responsiveHoverEvidence) {
    return [];
  }
  const paths = new Set<string>();
  for (const breakpoint of responsiveHoverEvidence.breakpoints) {
    for (const unit of breakpoint.units) {
      for (const component of unit.components) {
        if (component.default_screenshot) {
          paths.add(join(runDir, component.default_screenshot));
        }
        if (component.hover_screenshot) {
          paths.add(join(runDir, component.hover_screenshot));
        }
      }
    }
  }
  return [...paths];
}

async function buildStyleguideAgentEvidence(input: {
  runId: string;
  url: string;
  runDir: string;
  curatedManifestPath: string;
  curatedManifest: StyleMdCuratedManifest;
  responsiveHoverEvidencePath?: string;
  designTokenManifestPath?: string; // NEW
  semanticStructurePath?: string;   // NEW
}): Promise<StyleguideAgentEvidence> {
  const {
    runId,
    url,
    runDir,
    curatedManifestPath,
    curatedManifest,
    responsiveHoverEvidencePath,
    designTokenManifestPath,
    semanticStructurePath,
  } = input;

  return {
    run_id: runId,
    url,
    generated_at: nowIso(),
    full_screenshot: "full_screenshot.png",
    curated_manifest: toRunRelative(runDir, curatedManifestPath),
    responsive_hover_evidence: responsiveHoverEvidencePath ? toRunRelative(runDir, responsiveHoverEvidencePath) : null,
    design_token_manifest: designTokenManifestPath ? toRunRelative(runDir, designTokenManifestPath) : null,
    semantic_structure: semanticStructurePath ? toRunRelative(runDir, semanticStructurePath) : null,
    unit_count: curatedManifest.units.length,
    units: await Promise.all(curatedManifest.units.map(async (unit) => ({
      unit_id: unit.unit_id,
      type: unit.type,
      study_label: unit.study_label,
      reason: unit.reason,
      component_ids: [...unit.component_ids],
      // Increase component count per unit for denser evidence
      components: await Promise.all(unit.components.slice(0, 3).map(async (component) => {
        const metadataJson = await safeReadJson(component.metadataPath);
        const domAgentText = await safeReadText(component.agentDomPath);
        const stylesAgentJson = await safeReadJson(component.agentStylesPath);
        const pseudoAgentJson = await safeReadJson(component.agentPseudoStylesPath);
        const styleTreeAgentJson = await safeReadJson(component.agentStyleTreePath);

        const metadata = metadataJson && typeof metadataJson === "object"
          ? metadataJson as Record<string, unknown>
          : null;
        const pseudoObj = pseudoAgentJson && typeof pseudoAgentJson === "object"
          ? pseudoAgentJson as Record<string, unknown>
          : {};

        return {
          component_id: component.componentId,
          selector: component.selector,
          tag_name: component.tagName,
          rect: component.rect,
          files: {
            screenshot: toRunRelative(runDir, component.screenshotPath),
            metadata: toRunRelative(runDir, component.metadataPath),
            dom_agent: toRunRelative(runDir, component.agentDomPath),
            styles_agent: toRunRelative(runDir, component.agentStylesPath),
            pseudo_agent: toRunRelative(runDir, component.agentPseudoStylesPath),
            style_tree_agent: toRunRelative(runDir, component.agentStyleTreePath),
          },
          evidence: {
            metadata: {
              children_count: typeof metadata?.childrenCount === "number" ? metadata.childrenCount : null,
            },
            dom_excerpt: domAgentText ? cleanSnippet(domAgentText, 1000) : "",
            styles: toStringMap(stylesAgentJson),
            pseudo: {
              before: toStringMap(pseudoObj.before),
            },
            style_tree_head: normalizeStyleTreeEntries(styleTreeAgentJson),
          },
        };
      })),
    }))),
  };
}

function buildPromptInput(input: {
  runId: string;
  url: string;
  runDir: string;
  curatedManifestPath: string;
  evidenceAgentPath: string;
  responsiveHoverEvidencePath?: string;
  curatedManifest: StyleMdCuratedManifest;
  typographyInventory: Array<{
    family: string;
    usage_count: number;
  }>;
  requiredTypographyFamilies: string[];
}): StyleguidePromptInput {
  const {
    runId,
    url,
    runDir,
    curatedManifestPath,
    evidenceAgentPath,
    responsiveHoverEvidencePath,
    curatedManifest,
    typographyInventory,
    requiredTypographyFamilies,
  } = input;

  return {
    run_id: runId,
    url,
    generated_at: nowIso(),
    run_dir: ".",
    full_screenshot: "full_screenshot.png",
    curated_manifest: toRunRelative(runDir, curatedManifestPath),
    evidence_agent: toRunRelative(runDir, evidenceAgentPath),
    responsive_hover_evidence: responsiveHoverEvidencePath ? toRunRelative(runDir, responsiveHoverEvidencePath) : null,
    typography_inventory: typographyInventory,
    required_typography_families: requiredTypographyFamilies,
    unit_count: curatedManifest.units.length,
    units: curatedManifest.units.map((unit) => ({
      unit_id: unit.unit_id,
      type: unit.type,
      study_label: unit.study_label,
      component_ids: [...unit.component_ids],
    })),
  };
}

function buildStyleguidePrompt(promptInput: StyleguidePromptInput): string {
  return [
    "Generate final style.md from curated compact evidence.",
    "You are in an isolated read-only workspace containing only approved agent artifacts.",
    "Use only these tools: Read, Grep, Glob, LS.",
    "Never call Agent, WebSearch, WebFetch, Bash, Edit, Write, or MultiEdit.",
    "All file paths are relative to the workspace root. Never prefix paths with '/'.",
    "For large JSON/text files, use Read with non-negative offset + limit windows.",
    "",
    "Primary files to inspect (MANDATORY):",
    "- styleguide/evidence.agent.json (Entry point)",
    "- semantic_analysis.json (DESIGN TOKEN SOURCE OF TRUTH)",
    "- semantic_structure.json (PAGE STRUCTURE SOURCE OF TRUTH)",
    "- components/<id>/ (Specific component details)",
    "",
    "Output requirements:",
    "1. Output markdown only (DESIGN.md format). The output MUST start with '# ' (an H1 heading).",
    "2. ABSOLUTELY NO RAW CSS: Do NOT copy, quote, or reproduce any CSS rules, selectors, properties, or stylesheet content from the workspace. Describe visual properties in plain English prose only (e.g., write 'buttons use 8px corner radius' not '.btn { border-radius: 8px }').",
    "3. FOCUS ON VISUAL IDENTITY: Use palette, typography, and spacing from semantic_analysis.json as the primary ground truth to preserve brand personality.",
    "4. ATMOSPHERIC DEPTH: Use semantic_structure.json to understand the surface hierarchy (canvas, hero, card, etc.) and preserve visual atmosphere.",
    "5. IDENTIFY BRAND MOOD: Classify the site style (e.g., Cinematic, Brutalist, Luxury, Corporate) based on spacing, typography weight, and shadow usage.",
    "6. COMPOSITED APPEARANCE: Prioritize the 'effective' backgrounds and area-weighted colors over raw CSS values.",
    "7. SNAPPING: Use the normalized/snapped pixel values for spacing and radius.",
    "8. TYPOGRAPHY COVERAGE: Explicitly cover all required observed families from run context.",
    "9. GROUNDING: Every claim MUST be grounded in evidence; use '[unconfirmed]' where evidence is weak or missing.",
    "10. STRUCTURED JSON: At the end of the markdown, include a fenced code block labeled `stylemd-json`. You MUST use ONLY these observed families: " + promptInput.required_typography_families.join(", ") + ". Schema: { \"typography\": { \"display\": \"Font Name\", \"body\": \"Font Name\", \"scale\": \"modern\" | \"editorial\" }, \"fonts\": [ { \"name\": \"Font Name\", \"role\": \"Display\" | \"Body\" | \"UI\" | \"Mono\" } ], \"palette\": [ { \"name\": \"Label\", \"hex\": \"#HEX\", \"desc\": \"role\" } ], \"mood\": \"MoodName\", \"radius\": \"sharp\" | \"medium\" | \"pill\" | \"organic\", \"spacing\": \"4px\" | \"8px\" | string, \"cornerRadius\": \"4px\" | \"8px\" | string, \"accentColor\": \"#HEX\" }.",
    "",
    "Run context (JSON):",
    JSON.stringify(promptInput, null, 2),
    "",
    "Now inspect evidence and write style.md.",
  ].join("\n");
}

function buildRetryPrompt(input: {
  promptInput: StyleguidePromptInput;
  qualityIssues: string[];
  previousDraft: string;
}): string {
  const { promptInput, qualityIssues, previousDraft } = input;
  return [
    "Rewrite style.md from evidence with higher coverage and quality.",
    "Use only these tools: Read, Grep, Glob, LS.",
    "Never call Agent.",
    "Use relative paths only; do not prefix '/' on file paths.",
    "For large JSON/text files, use Read with non-negative offset + limit windows.",
    "The prior draft failed these checks:",
    ...qualityIssues.map((issue) => `- ${issue}`),
    "",
    "Keep markdown only. The output MUST start with '# ' (H1 heading). ABSOLUTELY NO raw CSS rules, selectors, or stylesheet content anywhere in the output — describe styles in plain English prose only.",
    "ENSURE the `stylemd-json` block is present and accurate at the end.",
    "Use styleguide/evidence.agent.json as source of truth.",
    "",
    "Run context (JSON):",
    JSON.stringify(
      {
        run_id: promptInput.run_id,
        url: promptInput.url,
        unit_count: promptInput.unit_count,
        evidence_agent: promptInput.evidence_agent,
        required_typography_families: promptInput.required_typography_families,
      },
      null,
      2,
    ),
    "",
    "Previous draft:",
    previousDraft,
  ].join("\n");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function validateStyleguideMarkdownQuality(
  markdown: string,
  requiredTypographyFamilies: string[],
): string[] {
  const issues: string[] = [];
  const trimmed = markdown.trim();

  if (!trimmed) {
    issues.push("markdown is empty");
    return issues;
  }
  if (trimmed.length < 220) {
    issues.push("markdown is too short to be reconstructable");
  }
  if (!/^#\s+/m.test(markdown) && !/^##\s+/m.test(markdown)) {
    issues.push("markdown has no section headings");
  }
  if (!/^#\s+/m.test(markdown)) {
    issues.push("markdown must start with an H1 heading (# Title), not CSS or other content");
  }
  if (/^\s*\/\*/.test(trimmed) || /^\s*[.#][\w-]+\s*\{/.test(trimmed)) {
    issues.push("output starts with raw CSS rules — must start with an H1 markdown heading instead");
  }
  // Detect large inline CSS dumps anywhere in the output (outside fenced blocks)
  const noFenced = markdown.replace(/```[\s\S]*?```/g, "");
  const cssRuleCount = (noFenced.match(/\{[^}]{5,200}\}/g) ?? []).filter(b => /:\s*[^;]+;/.test(b)).length;
  if (cssRuleCount > 5) {
    issues.push(`output contains ${cssRuleCount} raw CSS rule blocks — do NOT copy stylesheet content, describe styles in prose only`);
  }
  if (/^\s*[\[{]/.test(trimmed) && /"units"\s*:/.test(trimmed)) {
    issues.push("output appears to be JSON, not markdown");
  }

  for (const family of requiredTypographyFamilies) {
    const familyPattern = new RegExp(escapeRegExp(family), "i");
    if (!familyPattern.test(markdown)) {
      issues.push(`missing required typography family '${family}' in markdown output`);
    }
  }

  // Ensure stylemd-json block exists and contains all required families
  const jsonMatch = markdown.match(/```(?:stylemd-json|json)\s*\n([\s\S]*?)```/);
  if (!jsonMatch) {
    issues.push("missing required 'stylemd-json' block at the end of output");
  } else {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      const fonts = parsed.fonts || [];
      const jsonFamilies = new Set(fonts.map((f: any) => (f.name || "").toLowerCase()));
      
      for (const family of requiredTypographyFamilies) {
        if (!jsonFamilies.has(family.toLowerCase())) {
          issues.push(`structured JSON is missing required typography family '${family}'`);
        }
      }

      if (!parsed.typography?.display || !parsed.typography?.body) {
        issues.push("structured JSON is missing primary typography mapping (display/body)");
      }
    } catch {
      issues.push("structured JSON block is not valid JSON");
    }
  }

  const requiredCoverageChecks: Array<{ label: string; pattern: RegExp }> = [
    { label: "composition coverage", pattern: /composition|hierarchy|layout/i },
    { label: "color coverage", pattern: /color|palette|surface/i },
    { label: "spacing coverage", pattern: /spacing|rhythm|padding|margin/i },
    { label: "interaction coverage", pattern: /interaction|hover|focus|state/i },
    { label: "responsive coverage", pattern: /responsive|breakpoint|mobile|desktop/i },
  ];

  const missingCoverageLabels = requiredCoverageChecks
    .filter((check) => !check.pattern.test(markdown))
    .map((check) => check.label);

  // Require broad completeness without overfitting to exact vocabulary.
  if (missingCoverageLabels.length > 2) {
    issues.push(`missing coverage areas: ${missingCoverageLabels.join(", ")}`);
  }

  return issues;
}

function isRateLimitFailure(reason?: string): boolean {
  if (!reason) {
    return false;
  }
  const normalized = reason.toLowerCase();
  return normalized.includes("429")
    || normalized.includes("rate_limit")
    || normalized.includes("tpd rate limit")
    || normalized.includes("rate limit reached")
    || normalized.includes("quota");
}

function buildRateLimitedFallbackStyleMarkdown(input: {
  promptInput: StyleguidePromptInput;
  requiredTypographyFamilies: string[];
}): string {
  const { promptInput, requiredTypographyFamilies } = input;
  const unitLines = promptInput.units.slice(0, 12).map((unit, index) => (
    `${index + 1}. ${unit.study_label} (${unit.type}) - components: ${unit.component_ids.join(", ")}`
  ));
  const unitSummary = unitLines.length > 0
    ? unitLines.join("\n")
    : "1. [unconfirmed] No curated units available in fallback context.";
  const typographyFamilies = requiredTypographyFamilies.length > 0
    ? requiredTypographyFamilies.join(", ")
    : "[unconfirmed]";

  return [
    "# Style Guide (Rate-Limited Fallback)",
    "",
    `Source URL: ${promptInput.url}`,
    "",
    "## Composition",
    `- Curated units detected: ${promptInput.unit_count}`,
    "- This draft was generated with deterministic fallback because provider quota was exhausted.",
    "- Use this as a baseline and rerun when quota resets for full model-authored detail.",
    "",
    "## Unit Inventory",
    unitSummary,
    "",
    "## Typography",
    `- Required families observed: ${typographyFamilies}`,
    "- Local font loading should use ../page_styles/fonts/ with explicit fallback stacks.",
    "",
    "## Color and Surfaces",
    "- [unconfirmed] Derive final palette from styleguide/evidence.agent.json once quota is available.",
    "",
    "## Spacing and Layout",
    "- Preserve consistent spacing rhythm across unit variants.",
    "- Prefer predictable container widths and avoid introducing new breakpoints without evidence.",
    "",
    "## Interaction and States",
    "- [unconfirmed] Re-run synthesis to capture hover/focus states from responsive evidence.",
    "",
    "## Implementation Notes",
    "- Keep output deterministic and grounded in curated artifacts.",
    "- Re-run styleguide stage after quota reset to replace fallback sections marked [unconfirmed].",
    "",
  ].join("\n");
}

function buildShowcasePrompt(promptInput: ShowcasePromptInput): string {
  return [
    "Generate a static style showcase HTML page from style.md and compact evidence.",
    "Output HTML only (no markdown fences, no JSON, no preamble).",
    "Use only these tools: Read, Grep, Glob, LS.",
    "Never call Agent.",
    "Use relative workspace paths exactly as provided (for example 'page_styles/fonts.local.css', not '/page_styles/fonts.local.css').",
    "For large JSON/text files, use Read with non-negative offset + limit windows.",
    "",
    "Hard constraints:",
    "1. No <script> tags and no JavaScript execution.",
    "2. No external http/https assets.",
    "3. Use local font families from run context and reflect typography faithfully.",
    "4. Keep everything deterministic and self-contained for local rendering.",
    "5. Use plain numeric section labels like '1, 2, 3...' (never use the section symbol '§').",
    "6. Typography section must explicitly state local WOFF2 loading from '../page_styles/fonts/' and fallback behavior.",
    "7. Layout Containers section must explain why containers exist and when full-bleed layouts can omit them.",
    "",
    "Run context (JSON):",
    JSON.stringify(promptInput, null, 2),
  ].join("\n");
}

function buildShowcaseRepairPrompt(input: {
  promptInput: ShowcasePromptInput;
  previousOutput: string;
  failedIssues: string[];
  passNumber: number;
}): string {
  const { promptInput, previousOutput, failedIssues, passNumber } = input;
  const previousTrimmed =
    previousOutput.length > 30_000 ? `${previousOutput.slice(0, 30_000)}\n...[truncated previous output]` : previousOutput;

  return [
    `Repair the style showcase HTML. This is repair pass ${passNumber}.`,
    "Output HTML only (no markdown fences, no JSON, no preamble).",
    "Use only these tools: Read, Grep, Glob, LS.",
    "Never call Agent.",
    "Use relative workspace paths exactly as provided.",
    "For large JSON/text files, use Read with non-negative offset + limit windows.",
    "",
    "Previous output failed checks:",
    ...failedIssues.map((issue) => `- ${issue}`),
    "",
    "Preserve intended visual fidelity, but fix all failures and return one complete HTML document.",
    "Use plain numeric section labels only (no '§').",
    "Ensure typography copy explains local fonts from '../page_styles/fonts/' plus fallback behavior.",
    "Ensure Layout Containers copy explains purpose and optional full-bleed usage.",
    "",
    "Run context (compact JSON):",
    JSON.stringify({
      run_id: promptInput.run_id,
      url: promptInput.url,
      evidence_agent: promptInput.evidence_agent,
      full_screenshot: promptInput.full_screenshot,
      required_typography_families: promptInput.required_typography_families,
      font_assets: promptInput.font_assets,
      guardrails: promptInput.guardrails,
    }, null, 2),
    "",
    "Previous output:",
    previousTrimmed,
  ].join("\n");
}

function normalizeHtmlFromModel(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }
  const fencedMatch = trimmed.match(/```(?:html)?\s*([\s\S]*?)```/i);
  const candidate = fencedMatch?.[1] ? fencedMatch[1].trim() : trimmed;
  const doctypeIndex = candidate.search(/<!doctype\s+html/i);
  const htmlIndex = candidate.search(/<html\b/i);
  let startIndex = -1;
  if (doctypeIndex >= 0 && htmlIndex >= 0) {
    startIndex = Math.min(doctypeIndex, htmlIndex);
  } else if (doctypeIndex >= 0) {
    startIndex = doctypeIndex;
  } else if (htmlIndex >= 0) {
    startIndex = htmlIndex;
  }
  if (startIndex > 0) {
    return candidate.slice(startIndex).trim();
  }
  return candidate;
}

function getShowcaseRepairPassBudget(): number {
  const raw = process.env.STYLEMD_SHOWCASE_MAX_REPAIR_PASSES;
  if (!raw) {
    return DEFAULT_SHOWCASE_REPAIR_PASSES;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_SHOWCASE_REPAIR_PASSES;
  }
  return Math.min(parsed, SHOWCASE_REPAIR_PASS_CAP);
}

async function validateShowcaseHtmlInSandbox(input: {
  html: string;
  signal: AbortSignal;
  skip: boolean;
}): Promise<ShowcaseSandboxValidation> {
  if (input.skip) {
    return {
      ok: true,
      issues: [],
      diagnostics: {
        skipped: true,
        reason: "sandbox validation skipped for mocked styleguide query",
        nodeCount: 0,
        hasPrimaryContent: true,
        bodyTextLength: 0,
        pageErrors: [],
        consoleErrors: [],
        requestFailures: [],
      },
    };
  }

  assertNotAborted(input.signal);

  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const requestFailures: string[] = [];
  let nodeCount = 0;
  let hasPrimaryContent = false;
  let bodyTextLength = 0;

  const browser = await chromium.launch(getPlaywrightLaunchOptions());
  try {
    const context = await browser.newContext({
      viewport: { width: 1366, height: 900 },
      deviceScaleFactor: 1,
    });

    await context.addInitScript(() => {
      (window as any).__name = (t: any, v: any) => t;
    });
    try {
      const page = await context.newPage();
      page.on("pageerror", (error) => {
        pageErrors.push(errorToMessage(error));
      });
      page.on("console", (message) => {
        if (message.type() === "error") {
          consoleErrors.push(message.text());
        }
      });
      page.on("requestfailed", (request) => {
        const failure = request.failure();
        requestFailures.push(`${request.method()} ${request.url()} (${failure?.errorText ?? "failed"})`);
      });

      await page.setContent(input.html, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForLoadState("load", { timeout: 10_000 }).catch(() => undefined);
      await page.waitForTimeout(250);

      const domSummary = await page.evaluate(() => ({
        nodeCount: document.querySelectorAll("*").length,
        hasPrimaryContent: Boolean(document.querySelector("main, section, article, .styleguide-shell")),
        bodyTextLength: (document.body?.innerText ?? "").trim().length,
      }));
      nodeCount = domSummary.nodeCount;
      hasPrimaryContent = domSummary.hasPrimaryContent;
      bodyTextLength = domSummary.bodyTextLength;
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }

  const issues: string[] = [];
  if (pageErrors.length > 0) {
    issues.push(`sandbox page errors: ${pageErrors.slice(0, 3).join(" | ")}`);
  }
  if (consoleErrors.length > 0) {
    issues.push(`sandbox console errors: ${consoleErrors.slice(0, 3).join(" | ")}`);
  }
  if (nodeCount < 15) {
    issues.push(`sandbox render produced too few DOM nodes (${nodeCount})`);
  }
  if (!hasPrimaryContent) {
    issues.push("sandbox render missing primary content container");
  }
  if (bodyTextLength < 80) {
    issues.push(`sandbox render body text too short (${bodyTextLength} chars)`);
  }

  return {
    ok: issues.length === 0,
    issues,
    diagnostics: {
      skipped: false,
      nodeCount,
      hasPrimaryContent,
      bodyTextLength,
      pageErrors,
      consoleErrors,
      requestFailures,
    },
  };
}

function toPosixPath(value: string): string {
  return value.split(sep).join("/");
}

function toStyleMdShowcaseRelativeAssetPath(input: {
  runDir: string;
  absolutePath: string;
}): string {
  const showcaseDir = resolve(input.runDir, "styleguide");
  const rel = relative(showcaseDir, resolve(input.absolutePath));
  return toPosixPath(rel);
}

function normalizeReferencePath(ref: string): string {
  return ref.trim().replace(/\\/g, "/");
}

function resolveLocalRefToRunFile(input: {
  runDir: string;
  baseDir?: string;
  ref: string;
}): {
  ok: boolean;
  resolvedPath?: string;
  reason?: string;
} {
  const normalized = normalizeReferencePath(input.ref);
  if (!normalized) {
    return { ok: false, reason: "empty reference" };
  }
  if (
    normalized.startsWith("#") ||
    normalized.startsWith("data:") ||
    normalized.startsWith("blob:") ||
    normalized.startsWith("mailto:") ||
    normalized.startsWith("tel:")
  ) {
    return { ok: true };
  }
  if (/^(https?:)?\/\//i.test(normalized)) {
    return { ok: false, reason: "external_url" };
  }
  if (/^javascript:/i.test(normalized)) {
    return { ok: false, reason: "javascript_url" };
  }

  let candidateRef = normalized;
  if (normalized.startsWith("/api/stylemd-artifacts/artifact?")) {
    try {
      const artifactUrl = new URL(normalized, "http://stylemd.local");
      const artifactPath = artifactUrl.searchParams.get("path");
      if (!artifactPath) {
        return { ok: false, reason: "artifact_url_missing_path" };
      }
      candidateRef = decodeURIComponent(artifactPath);
    } catch {
      return { ok: false, reason: "invalid_artifact_url" };
    }
  }

  const runRoot = resolve(input.runDir);
  const baseDir = resolve(input.baseDir ?? input.runDir);
  const showcaseDir = resolve(runRoot, "styleguide");

  const candidates = new Set<string>();
  if (isAbsolute(candidateRef)) {
    candidates.add(resolve(candidateRef));
  } else {
    const cleaned = candidateRef.replace(/^\.?\//, "");
    const relToRun = cleaned.startsWith("/") ? cleaned.slice(1) : cleaned;
    candidates.add(resolve(baseDir, relToRun));
    candidates.add(resolve(runRoot, relToRun));
    candidates.add(resolve(showcaseDir, relToRun));
    candidates.add(resolve(showcaseDir, candidateRef));
  }

  const validCandidates = [...candidates].filter((candidate) =>
    candidate === runRoot || candidate.startsWith(`${runRoot}${sep}`));
  if (validCandidates.length === 0) {
    return { ok: false, reason: "outside_run_dir" };
  }

  const existingCandidate = validCandidates.find((candidate) => existsSync(candidate));
  if (existingCandidate) {
    return {
      ok: true,
      resolvedPath: existingCandidate,
    };
  }

  return {
    ok: true,
    resolvedPath: validCandidates[0],
  };
}

function rewriteHtmlToLocalArtifactUrls(input: {
  runDir: string;
  html: string;
}): {
  html: string;
  issues: string[];
  rewrittenRefs: Array<{
    original: string;
    rewritten?: string;
    status: "kept" | "rewritten" | "blocked";
    reason?: string;
  }>;
} {
  const { runDir } = input;
  const issues: string[] = [];
  const rewrittenRefs: Array<{
    original: string;
    rewritten?: string;
    status: "kept" | "rewritten" | "blocked";
    reason?: string;
  }> = [];

  const rewriteRef = (ref: string): string => {
    const resolved = resolveLocalRefToRunFile({
      runDir,
      ref,
    });
    if (!resolved.ok) {
      issues.push(`Invalid showcase reference '${ref}' (${resolved.reason ?? "invalid"}).`);
      rewrittenRefs.push({
        original: ref,
        status: "blocked",
        reason: resolved.reason,
      });
      return ref;
    }
    if (!resolved.resolvedPath) {
      rewrittenRefs.push({
        original: ref,
        rewritten: ref,
        status: "kept",
      });
      return ref;
    }
    const rewritten = toStyleMdShowcaseRelativeAssetPath({
      runDir,
      absolutePath: resolved.resolvedPath,
    });
    rewrittenRefs.push({
      original: ref,
      rewritten,
      status: "rewritten",
    });
    return rewritten;
  };

  const attrRegex = /\b(src|href)\s*=\s*(["'])(.*?)\2/gi;
  let rewrittenHtml = input.html.replace(attrRegex, (_match, attrName: string, quote: string, value: string) => {
    const next = rewriteRef(value);
    return `${attrName}=${quote}${next}${quote}`;
  });

  const cssUrlRegex = /url\(\s*(["']?)([^"')]+)\1\s*\)/gi;
  rewrittenHtml = rewrittenHtml.replace(cssUrlRegex, (_match, quote: string, value: string) => {
    const next = rewriteRef(value);
    return `url(${quote || "\""}${next}${quote || "\""})`;
  });

  return {
    html: rewrittenHtml,
    issues,
    rewrittenRefs,
  };
}

function injectLocalFontCssIntoHtml(html: string, fontCss: string): string {
  if (!fontCss.trim()) {
    return html;
  }

  const styleTag = `<style data-stylemd-local-fonts="1">\n${fontCss}\n</style>`;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (match) => `${match}\n${styleTag}`);
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html[^>]*>/i, (match) => `${match}\n<head>${styleTag}</head>`);
  }
  return `${styleTag}\n${html}`;
}

function rewriteLocalFontCssToArtifactUrls(input: {
  runDir: string;
  cssText: string;
}): {
  cssText: string;
  issues: string[];
} {
  const { runDir } = input;
  const issues: string[] = [];
  const cssUrlRegex = /url\(\s*(["']?)([^"')]+)\1\s*\)/gi;
  const cssBaseDir = resolve(runDir, "page_styles");

  const rewritten = input.cssText.replace(cssUrlRegex, (_match, quote: string, value: string) => {
    const resolved = resolveLocalRefToRunFile({
      runDir,
      baseDir: cssBaseDir,
      ref: value,
    });
    if (!resolved.ok) {
      issues.push(`Invalid font CSS reference '${value}' (${resolved.reason ?? "invalid"}).`);
      return _match;
    }
    if (!resolved.resolvedPath) {
      return _match;
    }
    const next = toStyleMdShowcaseRelativeAssetPath({
      runDir,
      absolutePath: resolved.resolvedPath,
    });
    return `url(${quote || "\""}${next}${quote || "\""})`;
  });

  return {
    cssText: rewritten,
    issues,
  };
}

type LocalizedFontEntry = StyleMdFontManifest["entries"][number] & {
  status: "localized";
  localArtifactPath: string;
};

function normalizeFontIdentity(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;

  const dp: number[] = [];
  for (let j = 0; j <= b.length; j += 1) {
    dp[j] = j;
  }

  for (let i = 1; i <= a.length; i += 1) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const temp = dp[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(
        dp[j] + 1,
        dp[j - 1] + 1,
        prev + cost,
      );
      prev = temp;
    }
  }

  return dp[b.length];
}

function extractNormalizedSourceIdentities(entry: LocalizedFontEntry): string[] {
  const identities = new Set<string>();
  const sources = [entry.originalSource, entry.resolvedSource].filter(Boolean);

  for (const source of sources) {
    const normalizedSource = normalizeFontIdentity(source);
    if (normalizedSource.length >= 6) {
      identities.add(normalizedSource);
    }

    if (!source.toLowerCase().startsWith("data:")) {
      try {
        const url = new URL(source);
        const fileName = decodeURIComponent(url.pathname.split("/").pop() ?? "");
        const normalizedFile = normalizeFontIdentity(fileName);
        if (normalizedFile.length >= 4) {
          identities.add(normalizedFile);
        }
        const baseName = fileName.replace(/\.[a-z0-9]+$/i, "");
        const normalizedBaseName = normalizeFontIdentity(baseName);
        if (normalizedBaseName.length >= 4) {
          identities.add(normalizedBaseName);
        }
      } catch {
        // ignore source parse errors
      }
    }
  }

  return [...identities];
}

function scoreLocalizedFontCandidate(requiredFamily: string, entry: LocalizedFontEntry): number {
  const requiredNorm = normalizeFontIdentity(requiredFamily);
  const familyNorm = normalizeFontIdentity(entry.family);
  if (!requiredNorm || !familyNorm) {
    return 0;
  }
  if (requiredNorm === familyNorm) {
    return 1;
  }

  const sourceNorms = extractNormalizedSourceIdentities(entry);
  for (const sourceNorm of sourceNorms) {
    if (sourceNorm === requiredNorm) {
      return 0.99;
    }
    const sourceDistance = levenshteinDistance(requiredNorm, sourceNorm);
    const sourceMaxLen = Math.max(requiredNorm.length, sourceNorm.length);
    if (sourceMaxLen >= 8 && sourceDistance <= 2) {
      return 0.92;
    }
    if (sourceMaxLen >= 12 && sourceDistance <= 3) {
      return 0.88;
    }
  }

  if (sourceNorms.some((sourceNorm) => sourceNorm.includes(requiredNorm))) {
    return 0.96;
  }
  if (sourceNorms.some((sourceNorm) => requiredNorm.includes(sourceNorm) && sourceNorm.length >= 8)) {
    return 0.9;
  }

  if (requiredNorm.includes(familyNorm) && familyNorm.length >= 7) {
    return 0.82;
  }
  if (familyNorm.includes(requiredNorm) && requiredNorm.length >= 7) {
    return 0.78;
  }

  const distance = levenshteinDistance(requiredNorm, familyNorm);
  const maxLen = Math.max(requiredNorm.length, familyNorm.length);
  if (maxLen >= 6 && distance <= 2) {
    return 0.72;
  }
  if (maxLen >= 10 && distance <= 3) {
    return 0.68;
  }
  return 0;
}

function getLocalizedFontEntries(fontManifest: StyleMdFontManifest | null): LocalizedFontEntry[] {
  if (!fontManifest) {
    return [];
  }
  return fontManifest.entries.filter((entry): entry is LocalizedFontEntry => (
    entry.status === "localized" && typeof entry.localArtifactPath === "string" && entry.localArtifactPath.length > 0
  ));
}

function resolveRequiredTypographyToLocalizedFonts(input: {
  requiredFamilies: string[];
  fontManifest: StyleMdFontManifest | null;
}): Map<string, LocalizedFontEntry[]> {
  const localized = getLocalizedFontEntries(input.fontManifest);
  const resolved = new Map<string, LocalizedFontEntry[]>();

  for (const requiredFamily of input.requiredFamilies) {
    const scored = localized
      .map((entry) => ({
        entry,
        score: scoreLocalizedFontCandidate(requiredFamily, entry),
      }))
      .filter((item) => item.score >= 0.68)
      .sort((a, b) => b.score - a.score);

    if (scored.length === 0) {
      continue;
    }

    const best = scored[0];
    const bestFamilyNorm = normalizeFontIdentity(best.entry.family);
    const entries = localized.filter((entry) => normalizeFontIdentity(entry.family) === bestFamilyNorm);
    if (entries.length > 0) {
      resolved.set(requiredFamily, entries);
    }
  }

  return resolved;
}

function buildFontAliasCss(input: {
  runDir: string;
  aliases: Map<string, LocalizedFontEntry[]>;
}): string {
  const lines: string[] = [];
  const orderedFamilies = [...input.aliases.keys()].sort((a, b) => a.localeCompare(b));

  for (const requiredFamily of orderedFamilies) {
    const entries = input.aliases.get(requiredFamily) ?? [];
    const seen = new Set<string>();
    for (const entry of entries) {
      if (!entry.localArtifactPath) {
        continue;
      }
      const signature = `${entry.weight}|${entry.style}|${entry.localArtifactPath}`;
      if (seen.has(signature)) {
        continue;
      }
      seen.add(signature);

      const relPath = toRunRelative(input.runDir, entry.localArtifactPath);
      const src = entry.format
        ? `url("${relPath}") format("${entry.format}")`
        : `url("${relPath}")`;
      lines.push("@font-face {");
      lines.push(`  font-family: "${requiredFamily}";`);
      lines.push(`  font-style: ${entry.style};`);
      lines.push(`  font-weight: ${entry.weight};`);
      lines.push(`  src: ${src};`);
      lines.push("  font-display: swap;");
      lines.push("}");
      lines.push("");
    }
  }

  return lines.join("\n").trim();
}

function validateShowcaseHtml(input: {
  html: string;
  requiredTypographyFamilies: string[];
}): string[] {
  const issues: string[] = [];
  const normalized = input.html.trim();

  if (!normalized) {
    issues.push("showcase HTML is empty");
    return issues;
  }
  if (!/<(html|body|main|section|div)\b/i.test(normalized)) {
    issues.push("showcase output does not look like HTML");
  }
  if (!/^(<!doctype\s+html\b|<html\b)/i.test(normalized)) {
    issues.push("showcase HTML must start with <!doctype html> or <html>");
  }
  if (/<script\b/i.test(normalized)) {
    issues.push("showcase contains disallowed <script> tag");
  }
  if (/\b(?:src|href)\s*=\s*["']https?:\/\//i.test(normalized) || /url\(\s*["']?https?:\/\//i.test(normalized)) {
    issues.push("showcase contains external http(s) asset reference");
  }
  if (/\/api\/stylemd-artifacts\/artifact\?/i.test(normalized)) {
    issues.push("showcase contains legacy /api/stylemd-artifacts/artifact references");
  }

  for (const family of input.requiredTypographyFamilies) {
    const familyPattern = new RegExp(escapeRegExp(family), "i");
    if (!familyPattern.test(normalized)) {
      issues.push(`showcase does not include required typography family '${family}'`);
    }
  }

  return issues;
}

function collectPathCandidates(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectPathCandidates(item));
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .flatMap(([key, item]) => {
        if (
          key.toLowerCase().includes("path") ||
          key.toLowerCase().includes("file") ||
          key.toLowerCase().includes("pattern")
        ) {
          return collectPathCandidates(item);
        }
        return [];
      });
  }
  return [];
}

function isWithinWorkspace(workspaceDir: string, candidatePath: string): boolean {
  const resolvedWorkspace = resolve(workspaceDir);
  const resolvedCandidate = resolve(workspaceDir, candidatePath);
  if (resolvedCandidate === resolvedWorkspace) {
    return true;
  }
  return resolvedCandidate.startsWith(`${resolvedWorkspace}${sep}`);
}

function normalizeWorkspaceCandidatePath(workspaceDir: string, candidatePath: string): string {
  const trimmed = candidatePath.trim();
  if (!trimmed) {
    return trimmed;
  }

  if (isWithinWorkspace(workspaceDir, trimmed)) {
    return trimmed;
  }

  if (trimmed.startsWith("/")) {
    const slashTrimmed = trimmed.replace(/^\/+/, "");
    if (isWithinWorkspace(workspaceDir, slashTrimmed)) {
      return slashTrimmed;
    }
  }

  return trimmed;
}

function isRawPath(candidatePath: string): boolean {
  const normalized = candidatePath.replace(/\\/g, "/").toLowerCase();
  return RAW_BLOCKLIST_PATTERNS.some((pattern) => normalized.includes(pattern));
}

function hasReadWindow(toolInput: unknown): boolean {
  if (!toolInput || typeof toolInput !== "object") {
    return false;
  }
  const input = toolInput as Record<string, unknown>;
  return typeof input.offset === "number" || typeof input.limit === "number";
}

function isBinaryFile(filePath: string): boolean {
  const normalized = filePath.toLowerCase().replace(/\\/g, "/");
  const binaryExtensions = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svg", ".zip", ".gz", ".tar"];
  return binaryExtensions.some((ext) => normalized.endsWith(ext));
}

function createPreToolUsePathGuard(input: {
  runId: string;
  workspaceDir: string;
  stageName: "styleguide" | "showcase";
}): HookCallback {
  const { runId, workspaceDir, stageName } = input;

  return async (hookInput) => {
    if (hookInput.hook_event_name !== "PreToolUse") {
      return { continue: true };
    }

    if (!STYLEGUIDE_ALLOWED_TOOLS.includes(hookInput.tool_name)) {
      const reason = `Blocked tool '${hookInput.tool_name}' in raw-safe styleguide mode. Allowed tools: ${STYLEGUIDE_ALLOWED_TOOLS.join(", ")}.`;
      emitObservedStyleMdEvent(runId, {
        type: "stylemd_action",
        source: "system",
        runId,
        stage: stageName,
        level: "warn",
        message: reason,
      });
      return {
        continue: false,
        decision: "block",
        reason,
      };
    }

    const candidates = collectPathCandidates(hookInput.tool_input)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    const readWindow = hookInput.tool_name === "Read" && hasReadWindow(hookInput.tool_input);

    for (const candidate of candidates) {
      const normalizedCandidate = normalizeWorkspaceCandidatePath(workspaceDir, candidate);
      if (isRawPath(normalizedCandidate) || !isWithinWorkspace(workspaceDir, normalizedCandidate)) {
        const reason = `Blocked path '${candidate}' outside raw-safe styleguide workspace.`;
        emitObservedStyleMdEvent(runId, {
          type: "stylemd_action",
          source: "system",
          runId,
          stage: stageName,
          level: "warn",
          message: reason,
        });
        return {
          continue: false,
          decision: "block",
          reason,
        };
      }

      if (hookInput.tool_name === "Read") {
        if (!readWindow) {
          try {
            const resolvedCandidate = resolve(workspaceDir, normalizedCandidate);
            const fileStat = await stat(resolvedCandidate);
            if (fileStat.isFile()) {
              if (isBinaryFile(normalizedCandidate)) {
                const reason = `Blocked read of binary file '${candidate}'. Only text files can be read.`;
                emitObservedStyleMdEvent(runId, {
                  type: "stylemd_action",
                  source: "system",
                  runId,
                  stage: stageName,
                  level: "warn",
                  message: reason,
                });
                return {
                  continue: false,
                  decision: "block",
                  reason,
                };
              }
              if (fileStat.size > STYLEGUIDE_MAX_READ_BYTES) {
                const reason = `Blocked oversized read '${candidate}' (${fileStat.size} bytes). Re-run Read with offset/limit windows.`;
                emitObservedStyleMdEvent(runId, {
                  type: "stylemd_action",
                  source: "system",
                  runId,
                  stage: stageName,
                  level: "warn",
                  message: reason,
                });
                return {
                  continue: false,
                  decision: "block",
                  reason,
                };
              }
            }
          } catch {
            // Missing files should surface via normal tool errors.
          }
        }
      }
    }

    return { continue: true };
  };
}

async function prepareStyleguideWorkspace(input: {
  runDir: string;
  curatedManifestPath: string;
  evidenceAgentPath: string;
  responsiveHoverEvidencePath?: string;
  responsiveScreenshotPaths: string[];
  curatedManifest: StyleMdCuratedManifest;
  extraApprovedPaths?: string[];
  workspaceName?: "styleguide" | "showcase";
}): Promise<string> {
  const {
    runDir,
    curatedManifestPath,
    evidenceAgentPath,
    responsiveHoverEvidencePath,
    responsiveScreenshotPaths,
    curatedManifest,
    extraApprovedPaths = [],
    workspaceName = "styleguide",
  } = input;

  const workspaceDir = join(runDir, "agent_workspace", workspaceName);
  await rm(workspaceDir, { recursive: true, force: true });
  await mkdir(workspaceDir, { recursive: true });

  const approvedPaths = new Set<string>([
    join(runDir, "full_screenshot.png"),
    curatedManifestPath,
    evidenceAgentPath,
    ...responsiveScreenshotPaths,
    ...extraApprovedPaths,
  ]);

  if (responsiveHoverEvidencePath) {
    approvedPaths.add(responsiveHoverEvidencePath);
  }

  for (const unit of curatedManifest.units) {
    for (const component of unit.components) {
      approvedPaths.add(component.screenshotPath);
      approvedPaths.add(component.metadataPath);
      approvedPaths.add(component.agentDomPath);
      approvedPaths.add(component.agentStylesPath);
      approvedPaths.add(component.agentPseudoStylesPath);
      approvedPaths.add(component.agentStyleTreePath);
    }
  }

  for (const sourcePath of approvedPaths) {
    if (!(await fileExists(sourcePath))) {
      continue;
    }
    const rel = toRunRelative(runDir, sourcePath);
    const destination = join(workspaceDir, rel);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(sourcePath, destination);
  }

  return workspaceDir;
}

async function runClaudeStyleguideQuery(input: ClaudeStyleguideQueryInput): Promise<string> {
  const {
    runId,
    workspaceDir,
    runtime,
    stageName = "styleguide",
    systemPrompt,
    prompt,
    signal,
    queryLabel = `${stageName}`,
  } = input;
  const providerLabel = runtime.provider === "kimi" ? "Kimi" : "Claude";
  const stageTag = buildStageTag(runId, stageName);
  const abortController = new AbortController();

  const onAbort = (): void => {
    abortController.abort();
  };
  signal.addEventListener("abort", onAbort, { once: true });

  if (signal.aborted) {
    abortController.abort();
  }

  const preToolPathGuard = createPreToolUsePathGuard({
    runId,
    workspaceDir,
    stageName,
  });

  const preToolUseHook: HookCallback = async (hookInput) => {
    const guardDecision = await preToolPathGuard(hookInput);
    const guardDecisionLike = guardDecision as { continue?: boolean; decision?: string };
    if (guardDecisionLike.continue === false || guardDecisionLike.decision === "block") {
      return guardDecision;
    }
    if (hookInput.hook_event_name !== "PreToolUse") {
      return guardDecision;
    }
    emitObservedStyleMdEvent(runId, {
      type: "tool_started",
      source: "system",
      toolName: `${stageTag} ${hookInput.tool_name}`,
      toolUseId: hookInput.tool_use_id,
      inputSummary: summarizeForLog(hookInput.tool_input),
      rawInput: hookInput.tool_input,
    });
    return { continue: true };
  };

  const postToolUseHook: HookCallback = async (hookInput) => {
    if (hookInput.hook_event_name !== "PostToolUse") {
      return { continue: true };
    }
    emitObservedStyleMdEvent(runId, {
      type: "tool_finished",
      source: "system",
      toolName: `${stageTag} ${hookInput.tool_name}`,
      toolUseId: hookInput.tool_use_id,
      outputSummary: summarizeForLog(hookInput.tool_response),
      rawOutput: hookInput.tool_response,
    });
    return { continue: true };
  };

  const postToolUseFailureHook: HookCallback = async (hookInput) => {
    if (hookInput.hook_event_name !== "PostToolUseFailure") {
      return { continue: true };
    }
    emitObservedStyleMdEvent(runId, {
      type: "tool_failed",
      source: "system",
      toolName: `${stageTag} ${hookInput.tool_name}`,
      toolUseId: hookInput.tool_use_id,
      error: hookInput.error,
      rawError: hookInput,
    });
    return { continue: true };
  };

  const result = await queryWithKimiBridge({
    runId,
    workspaceDir,
    runtime,
    systemPrompt,
    prompt,
    signal,
    queryLabel,
    stage: "styleguide",
    onTokenUsage: (inputTokens, outputTokens) => {
      storeTokenUsage(runId, queryLabel || "styleguide", inputTokens, outputTokens);
    },
  });

  const transcriptText =
    result.length > 12_000 ? `${result.slice(0, 12_000)}\n...[truncated stylemd styleguide output]` : result;
  
  emitObservedStyleMdEvent(runId, {
    type: "assistant_final_message",
    source: "agent",
    text: `${stageTag}\n${transcriptText}`,
  });

  return result;
}

export async function runStyleguideStage(input: RunStyleguideInput): Promise<StageOutput<StyleMdStyleguideResult>> {
  const {
    runId,
    url,
    curatedManifestPath,
    curatedManifest,
    responsiveHoverEvidencePath,
    signal,
  } = input;
  const runtime = input.runtime ?? resolveStyleMdRuntimeConfig("claude");
  const runClaudeQuery = input.runClaudeQuery ?? runClaudeStyleguideQuery;
  const runDir = getStyleMdRunDir(runId);
  const artifacts: StyleMdArtifactRecord[] = [];

  if (runtime.provider === "kimi") {
    console.log(`🎯 [STYLEMD] Using KIMI provider for styleguide stage`);
  } else {
    console.log(`🎯 [STYLEMD] Using CLAUDE provider for styleguide stage`);
  }

  assertNotAborted(signal);

  if (curatedManifest.units.length === 0) {
    const warning = "Styleguide synthesis failed. Reason: no curated units available.";
    const validationArtifact = await writeStyleMdJson(runId, join("styleguide", "validation.json"), {
      ok: false,
      attempts: 0,
      error: warning,
      mode: "single_pass_with_escalation_retry",
    });
    const responseRawArtifact = await writeStyleMdText(
      runId,
      join("styleguide", "response.raw.txt"),
      `${warning}\n`,
      "text",
    );
    artifacts.push(validationArtifact, responseRawArtifact);
    throw new StyleguideStageError(warning, warning, artifacts);
  }

  const responsiveHoverEvidence = responsiveHoverEvidencePath
    ? await safeReadJson(responsiveHoverEvidencePath) as StyleMdResponsiveHoverEvidence | null
    : null;

  const semanticAnalysisPath = join(runDir, "semantic_analysis.json");
  const semanticStructurePath = join(runDir, "semantic_structure.json");

  const evidenceAgent = await buildStyleguideAgentEvidence({
    runId,
    url,
    runDir,
    curatedManifestPath,
    curatedManifest,
    responsiveHoverEvidencePath,
    designTokenManifestPath: semanticAnalysisPath,
    semanticStructurePath: semanticStructurePath,
  });
  const evidenceAgentArtifact = await writeStyleMdJson(runId, join("styleguide", "evidence.agent.json"), evidenceAgent);
  artifacts.push(evidenceAgentArtifact);

  const typographyInventory = buildTypographyInventory(evidenceAgent);
  const requiredTypographyFamilies = deriveRequiredTypographyFamilies(typographyInventory);
  const typographyInventoryArtifact = await writeStyleMdJson(
    runId,
    join("styleguide", "typography.inventory.json"),
    {
      generated_at: nowIso(),
      inventory: typographyInventory,
      required_families: requiredTypographyFamilies,
    },
  );
  artifacts.push(typographyInventoryArtifact);

  const promptInput = buildPromptInput({
    runId,
    url,
    runDir,
    curatedManifestPath,
    evidenceAgentPath: evidenceAgentArtifact.path,
    responsiveHoverEvidencePath,
    curatedManifest,
    typographyInventory,
    requiredTypographyFamilies,
  });
  const promptInputArtifact = await writeStyleMdJson(runId, join("styleguide", "prompt_input.json"), promptInput);
  artifacts.push(promptInputArtifact);

  const workspaceDir = await prepareStyleguideWorkspace({
    runDir,
    curatedManifestPath,
    evidenceAgentPath: evidenceAgentArtifact.path,
    responsiveHoverEvidencePath,
    responsiveScreenshotPaths: collectResponsiveEvidenceScreenshotPaths(runDir, responsiveHoverEvidence),
    curatedManifest,
    extraApprovedPaths: [
      typographyInventoryArtifact.path,
      semanticAnalysisPath,
      semanticStructurePath,
    ],
  });

  const systemPrompt = [
    "You are a deterministic styleguide synthesis engine.",
    "Use only workspace artifacts.",
    "Use read-only tools only; do not modify files.",
    "Allowed tools: Read, Grep, Glob, LS. Never call Agent.",
    "All paths must be relative to workspace root. Never use leading '/'.",
    "No web access.",
    "Return markdown only.",
  ].join("\n");

  emitObservedStyleMdEvent(runId, {
    type: "stylemd_action",
    source: "system",
    runId,
    stage: "styleguide",
    level: "info",
    message: "Starting styleguide synthesis from compact agent evidence.",
    detail: {
      unit_count: curatedManifest.units.length,
      workspace: toRunRelative(runDir, workspaceDir),
      retry_policy: "one_escalation_retry",
    },
  });

  let attempt = 0;
  let responseRaw = "";
  let styleMarkdown = "";
  let failureReason: string | undefined;
  let qualityIssues: string[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const queryStartedAt = Date.now();

  try {
    attempt += 1;
    responseRaw = await runClaudeQuery({
      runId,
      workspaceDir,
      runtime,
      stageName: "styleguide",
      systemPrompt,
      prompt: buildStyleguidePrompt(promptInput),
      signal,
      queryLabel: "styleguide-pass-1",
    });
    
    // Accumulate tokens from pass 1
    const pass1Tokens = getTokenUsage(runId, "styleguide-pass-1");
    totalInputTokens += pass1Tokens.inputTokens;
    totalOutputTokens += pass1Tokens.outputTokens;
    
    const pass1Artifact = await writeStyleMdText(
      runId,
      join("styleguide", "synthesis.pass1.raw.txt"),
      `${responseRaw}\n`,
      "text",
    );
    artifacts.push(pass1Artifact);

    qualityIssues = validateStyleguideMarkdownQuality(responseRaw, requiredTypographyFamilies);
    if (qualityIssues.length > 0) {
      attempt += 1;
      const retryRaw = await runClaudeQuery({
        runId,
        workspaceDir,
        runtime,
        stageName: "styleguide",
        systemPrompt,
        prompt: buildRetryPrompt({
          promptInput,
          qualityIssues,
          previousDraft: responseRaw,
        }),
        signal,
        queryLabel: "styleguide-pass-2-escalation",
      });

      // Accumulate tokens from pass 2
      const pass2Tokens = getTokenUsage(runId, "styleguide-pass-2-escalation");
      totalInputTokens += pass2Tokens.inputTokens;
      totalOutputTokens += pass2Tokens.outputTokens;

      const pass2Artifact = await writeStyleMdText(
        runId,
        join("styleguide", "synthesis.pass2.raw.txt"),
        `${retryRaw}\n`,
        "text",
      );
      artifacts.push(pass2Artifact);

      responseRaw = retryRaw;
      qualityIssues = validateStyleguideMarkdownQuality(responseRaw, requiredTypographyFamilies);
      if (qualityIssues.length > 0) {
        throw new Error(`Styleguide quality check failed after retry: ${qualityIssues.join("; ")}`);
      }
    }

    const normalized = responseRaw.trim();
    if (!normalized) {
      throw new Error("Styleguide markdown is empty.");
    }
    styleMarkdown = normalized.endsWith("\n") ? normalized : `${normalized}\n`;
  } catch (error) {
    failureReason = errorToMessage(error);
  }

  const queryDurationMs = Date.now() - queryStartedAt;
  const responseRawArtifact = await writeStyleMdText(
    runId,
    join("styleguide", "response.raw.txt"),
    `${responseRaw || `Query error: ${failureReason ?? "No styleguide response."}`}\n`,
    "text",
  );
  artifacts.push(responseRawArtifact);

  if (failureReason) {
    if (runtime.provider === "kimi" && isRateLimitFailure(failureReason)) {
      styleMarkdown = buildRateLimitedFallbackStyleMarkdown({
        promptInput,
        requiredTypographyFamilies,
      });
      emitObservedStyleMdEvent(runId, {
        type: "stylemd_action",
        source: "system",
        runId,
        stage: "styleguide",
        level: "warn",
        message: "Kimi styleguide hit rate limit. Applied deterministic fallback style.md.",
        detail: {
          query_duration_ms: queryDurationMs,
          attempts: attempt,
          failure_reason: failureReason,
        },
      });
      failureReason = undefined;
    }
  }

  if (failureReason) {
    const validationArtifact = await writeStyleMdJson(runId, join("styleguide", "validation.json"), {
      ok: false,
      mode: "single_pass_with_escalation_retry",
      attempts: attempt,
      quality_issues: qualityIssues,
      query: {
        duration_ms: queryDurationMs,
        failed: true,
        failure_reason: failureReason,
        max_turns: null,
        timeout_ms: STYLEGUIDE_QUERY_TIMEOUT_MS,
      },
    });
    artifacts.push(validationArtifact);

    const warning = `Styleguide synthesis failed. Reason: ${failureReason}`;
    emitObservedStyleMdEvent(runId, {
      type: "stylemd_action",
      source: "system",
      runId,
      stage: "styleguide",
      level: "warn",
      message: warning,
      detail: {
        query_duration_ms: queryDurationMs,
        attempts: attempt,
      },
    });
    throw new StyleguideStageError(warning, warning, artifacts, {
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      totalTokens: totalInputTokens + totalOutputTokens,
      maxTurns: 0,
      timeoutMs: STYLEGUIDE_QUERY_TIMEOUT_MS,
      durationMs: queryDurationMs,
      failed: true,
      failureReason,
    });
  }

  const styleMdArtifact = await writeStyleMdText(runId, "style.md", styleMarkdown, "text");
  const validationArtifact = await writeStyleMdJson(runId, join("styleguide", "validation.json"), {
    ok: true,
    mode: "single_pass_with_escalation_retry",
    attempts: attempt,
    quality_issues: [],
    query: {
      duration_ms: queryDurationMs,
      failed: false,
      max_turns: null,
      timeout_ms: STYLEGUIDE_QUERY_TIMEOUT_MS,
    },
  });
  artifacts.push(validationArtifact, styleMdArtifact);

  emitObservedStyleMdEvent(runId, {
    type: "stylemd_action",
    source: "system",
    runId,
    stage: "styleguide",
    level: "info",
    message: "Styleguide synthesis completed.",
    detail: {
      query_duration_ms: queryDurationMs,
      markdown_chars: styleMarkdown.length,
      attempts: attempt,
    },
  });

  return {
    result: {
      styleMdPath: styleMdArtifact.path,
      promptInputPath: promptInputArtifact.path,
      responseRawPath: responseRawArtifact.path,
      validationPath: validationArtifact.path,
      evidenceAgentPath: evidenceAgentArtifact.path,
      workspaceDir,
      styleMarkdown,
      typographyInventoryPath: typographyInventoryArtifact.path,
      typographyInventory,
      requiredTypographyFamilies,
      query: {
        maxTurns: 0,
        timeoutMs: 0,
        durationMs: queryDurationMs,
        failed: false,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        totalTokens: totalInputTokens + totalOutputTokens,
      },
    },
    artifacts,
  };
}

export async function runShowcaseStage(input: RunShowcaseInput): Promise<StageOutput<StyleMdShowcaseResult>> {
  const {
    runId,
    url,
    curatedManifestPath,
    curatedManifest,
    responsiveHoverEvidencePath,
    styleMdPath,
    evidenceAgentPath,
    fontsManifestPath,
    fontsLocalCssPath,
    signal,
  } = input;
  const runtime = input.runtime ?? resolveStyleMdRuntimeConfig("claude");
  const runClaudeQuery = input.runClaudeQuery ?? runClaudeStyleguideQuery;
  const runDir = getStyleMdRunDir(runId);
  const artifacts: StyleMdArtifactRecord[] = [];

  if (runtime.provider === "kimi") {
    console.log(`🎯 [STYLEMD] Using KIMI provider for showcase stage`);
  } else {
    console.log(`🎯 [STYLEMD] Using CLAUDE provider for showcase stage`);
  }

  const showcaseBase = {
    available: false,
    canonicalUrl: `/styleguide/${runId}`,
    latestUrl: "/styleguide",
  } as const;

  assertNotAborted(signal);

  let styleMarkdown = input.styleMarkdown ?? "";
  if (!styleMarkdown.trim()) {
    styleMarkdown = (await safeReadText(styleMdPath)) ?? "";
  }
  const normalizedStyleMarkdown = styleMarkdown.trim();

  let typographyInventory = input.typographyInventory ?? [];
  let requiredTypographyFamilies = input.requiredTypographyFamilies ?? [];
  if (input.typographyInventoryPath) {
    const typographyArtifact = await safeReadJson(input.typographyInventoryPath);
    if (typographyArtifact && typeof typographyArtifact === "object") {
      const typographyObject = typographyArtifact as {
        inventory?: Array<{ family?: unknown; usage_count?: unknown }>;
        required_families?: unknown;
      };
      if (typographyInventory.length === 0 && Array.isArray(typographyObject.inventory)) {
        typographyInventory = typographyObject.inventory
          .map((entry) => ({
            family: typeof entry.family === "string" ? entry.family.trim() : "",
            usage_count: typeof entry.usage_count === "number" ? entry.usage_count : 0,
          }))
          .filter((entry) => entry.family.length > 0);
      }
      if (requiredTypographyFamilies.length === 0 && Array.isArray(typographyObject.required_families)) {
        requiredTypographyFamilies = typographyObject.required_families
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter((item) => item.length > 0);
      }
    }
  }
  if (requiredTypographyFamilies.length === 0) {
    requiredTypographyFamilies = deriveRequiredTypographyFamilies(typographyInventory);
  }

  const showcasePromptInput: ShowcasePromptInput = {
    run_id: runId,
    url,
    generated_at: nowIso(),
    style_md: normalizedStyleMarkdown,
    full_screenshot: "full_screenshot.png",
    evidence_agent: toRunRelative(runDir, evidenceAgentPath),
    typography_inventory: typographyInventory,
    required_typography_families: requiredTypographyFamilies,
    font_assets: {
      manifest: fontsManifestPath ? toRunRelative(runDir, fontsManifestPath) : null,
      local_css: fontsLocalCssPath ? toRunRelative(runDir, fontsLocalCssPath) : null,
    },
    guardrails: {
      disallow_external_http: true,
      disallow_scripts: true,
      static_html_only: true,
    },
  };

  const showcasePromptInputArtifact = await writeStyleMdJson(
    runId,
    join("styleguide", "showcase.prompt_input.json"),
    showcasePromptInput,
  );
  artifacts.push(showcasePromptInputArtifact);

  const queryStartedAt = Date.now();
  let queryFailed = false;
  let queryFailureReason: string | undefined;
  let showcaseWarning: string | undefined;
  let showcaseHtmlArtifactPath: string | undefined;
  let rewrittenRefs: Array<{
    original: string;
    rewritten?: string;
    status: "kept" | "rewritten" | "blocked";
    reason?: string;
  }> = [];
  let validationIssues: string[] = [];
  let lastSandboxValidation: ShowcaseSandboxValidation | null = null;
  const responsePasses: Array<{ pass: number; queryLabel: string; raw: string }> = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  const evidenceAgentExists = await fileExists(evidenceAgentPath);
  if (!normalizedStyleMarkdown) {
    showcaseWarning = "Showcase generation skipped. style.md is missing or empty.";
    validationIssues.push("style.md is missing or empty");
  } else if (!evidenceAgentExists) {
    showcaseWarning = "Showcase generation skipped. styleguide evidence artifact is missing.";
    validationIssues.push("styleguide evidence artifact is missing");
  }

  const fontManifest = fontsManifestPath
    ? await safeReadJson(fontsManifestPath) as StyleMdFontManifest | null
    : null;
  const fontCssRaw = fontsLocalCssPath
    ? (await safeReadText(fontsLocalCssPath)) ?? ""
    : "";
  const requiredFamilyResolution = resolveRequiredTypographyToLocalizedFonts({
    requiredFamilies: requiredTypographyFamilies,
    fontManifest,
  });
  const unresolvedLocalFamilies = requiredTypographyFamilies.filter((family) =>
    !requiredFamilyResolution.has(family));
  const aliasFontCss = buildFontAliasCss({
    runDir,
    aliases: requiredFamilyResolution,
  });
  const effectiveFontCss = [fontCssRaw, aliasFontCss].filter((chunk) => chunk.trim().length > 0).join("\n\n");

  if (!showcaseWarning && unresolvedLocalFamilies.length > 0) {
    showcaseWarning = `Showcase generation skipped. Required typography families are not localized: ${unresolvedLocalFamilies.join(", ")}.`;
    validationIssues.push(`missing localized families: ${unresolvedLocalFamilies.join(", ")}`);
  }

  if (!showcaseWarning) {
    const responsiveHoverEvidence = responsiveHoverEvidencePath
      ? await safeReadJson(responsiveHoverEvidencePath) as StyleMdResponsiveHoverEvidence | null
      : null;

    const workspaceDir = await prepareStyleguideWorkspace({
      runDir,
      curatedManifestPath,
      evidenceAgentPath,
      responsiveHoverEvidencePath,
      responsiveScreenshotPaths: collectResponsiveEvidenceScreenshotPaths(runDir, responsiveHoverEvidence),
      curatedManifest,
      extraApprovedPaths: [
        styleMdPath,
        input.typographyInventoryPath ?? "",
        fontsManifestPath ?? "",
        fontsLocalCssPath ?? "",
      ].filter(Boolean),
      workspaceName: "showcase",
    });

    const configuredRepairPasses = getShowcaseRepairPassBudget();
    const maxRepairPasses = input.runClaudeQuery
      ? Math.min(configuredRepairPasses, 3)
      : Math.min(configuredRepairPasses, 6);

    emitObservedStyleMdEvent(runId, {
      type: "stylemd_action",
      source: "system",
      runId,
      stage: "showcase",
      level: "info",
      message: "Starting showcase generation from style.md and local evidence.",
      detail: {
        workspace: toRunRelative(runDir, workspaceDir),
        max_repair_passes: maxRepairPasses,
      },
    });

    const querySystemPrompt = [
      "You are a deterministic style showcase generator.",
      "Use only local workspace evidence.",
      "Allowed tools: Read, Grep, Glob, LS. Never call Agent.",
      "All paths must be relative to workspace root. Never use leading '/'.",
      "Output one static HTML document only.",
      "No script tags. No JavaScript.",
      "No external http/https assets.",
      "Use plain numeric section labels (no '§').",
      "Typography copy must explain local fonts from '../page_styles/fonts/' and fallback behavior.",
      "Layout container copy must explain purpose and optional full-bleed usage.",
    ].join("\n");

    let previousOutput = "";
    let failedIssues: string[] = [];

    for (let passNumber = 1; passNumber <= maxRepairPasses; passNumber += 1) {
      assertNotAborted(signal);
      const queryLabel = `showcase-pass-${passNumber}`;
      const prompt = passNumber === 1
        ? buildShowcasePrompt(showcasePromptInput)
        : buildShowcaseRepairPrompt({
          promptInput: showcasePromptInput,
          previousOutput,
          failedIssues,
          passNumber,
        });

      let showcaseResponseRaw = "";
      try {
        showcaseResponseRaw = await runClaudeQuery({
          runId,
          workspaceDir,
          runtime,
          stageName: "showcase",
          systemPrompt: querySystemPrompt,
          prompt,
          signal,
          queryLabel,
        });
      } catch (error) {
        queryFailed = true;
        queryFailureReason = errorToMessage(error);
        failedIssues = [`query failure: ${queryFailureReason}`];
        responsePasses.push({
          pass: passNumber,
          queryLabel,
          raw: `Query error: ${queryFailureReason}`,
        });
        previousOutput = "";
        continue;
      }

      responsePasses.push({
        pass: passNumber,
        queryLabel,
        raw: showcaseResponseRaw,
      });

      // Accumulate token usage from this pass
      const passTokens = getTokenUsage(runId, queryLabel);
      totalInputTokens += passTokens.inputTokens;
      totalOutputTokens += passTokens.outputTokens;

      const normalizedHtml = normalizeHtmlFromModel(showcaseResponseRaw);
      previousOutput = normalizedHtml || showcaseResponseRaw;

      if (!normalizedHtml) {
        failedIssues = ["showcase generator returned empty HTML"];
        validationIssues = failedIssues;
        continue;
      }

      const rewrittenFontCss = rewriteLocalFontCssToArtifactUrls({
        runDir,
        cssText: effectiveFontCss,
      });

      const withFonts = injectLocalFontCssIntoHtml(normalizedHtml, rewrittenFontCss.cssText);
      const rewrittenHtmlResult = rewriteHtmlToLocalArtifactUrls({
        runDir,
        html: withFonts,
      });

      const finalShowcaseHtml = rewrittenHtmlResult.html;
      rewrittenRefs = rewrittenHtmlResult.rewrittenRefs;
      const staticValidationIssues = [
        ...rewrittenFontCss.issues,
        ...rewrittenHtmlResult.issues,
        ...validateShowcaseHtml({
          html: finalShowcaseHtml,
          requiredTypographyFamilies,
        }),
      ];
      const sandboxValidation = await validateShowcaseHtmlInSandbox({
        html: finalShowcaseHtml,
        signal,
        skip: Boolean(input.runClaudeQuery),
      });
      lastSandboxValidation = sandboxValidation;
      validationIssues = [...staticValidationIssues, ...sandboxValidation.issues];

      if (validationIssues.length === 0) {
        const normalizedFinal = finalShowcaseHtml.endsWith("\n") ? finalShowcaseHtml : `${finalShowcaseHtml}\n`;
        const showcaseHtmlArtifact = await writeStyleMdText(
          runId,
          join("styleguide", "showcase.html"),
          normalizedFinal,
          "html",
        );
        artifacts.push(showcaseHtmlArtifact);
        showcaseHtmlArtifactPath = showcaseHtmlArtifact.path;
        failedIssues = [];
        break;
      }

      failedIssues = [...validationIssues];
    }

    if (!showcaseHtmlArtifactPath) {
      if (validationIssues.length === 0 && queryFailureReason) {
        validationIssues = [`query failure: ${queryFailureReason}`];
      }
      const joinedIssues = validationIssues.length > 0 ? validationIssues.join("; ") : "unknown failure";
      showcaseWarning = `Showcase generation failed. Reason: ${joinedIssues}`;
    }
  }

  if (!showcaseHtmlArtifactPath && responsePasses.length > 0) {
    queryFailed = true;
    if (!queryFailureReason) {
      queryFailureReason = showcaseWarning;
    }
  }

  const queryDurationMs = Date.now() - queryStartedAt;
  const showcaseResponseArtifact = await writeStyleMdText(
    runId,
    join("styleguide", "showcase.response.raw.txt"),
    responsePasses.length > 0
      ? `${responsePasses.map((pass) => [
        `=== ${pass.queryLabel} ===`,
        pass.raw,
      ].join("\n")).join("\n\n")}\n`
      : `${showcaseWarning ?? "No showcase response."}\n`,
    "text",
  );
  artifacts.push(showcaseResponseArtifact);

  const showcaseValidationArtifact = await writeStyleMdJson(
    runId,
    join("styleguide", "showcase.validation.json"),
    {
      ok: Boolean(showcaseHtmlArtifactPath),
      required_families: requiredTypographyFamilies,
      missing_local_families: unresolvedLocalFamilies,
      resolved_family_aliases: Object.fromEntries(
        [...requiredFamilyResolution.entries()].map(([family, entries]) => [
          family,
          entries.map((entry) => entry.family),
        ]),
      ),
      references: rewrittenRefs,
      issues: validationIssues,
      warning: showcaseWarning,
      attempts: responsePasses.length,
      query: {
        duration_ms: queryDurationMs,
        failed: queryFailed,
        failure_reason: queryFailureReason,
      },
      sandbox: lastSandboxValidation?.diagnostics ?? {
        skipped: true,
        reason: "sandbox validation was not reached",
      },
    },
  );
  artifacts.push(showcaseValidationArtifact);
  const showcaseValidationArtifactPath = showcaseValidationArtifact.path;

  emitObservedStyleMdEvent(runId, {
    type: "stylemd_action",
    source: "system",
    runId,
    stage: "showcase",
    level: "info",
    message: "Showcase generation stage completed.",
    detail: {
      query_duration_ms: queryDurationMs,
      attempts: responsePasses.length,
      showcase_available: Boolean(showcaseHtmlArtifactPath),
    },
  });

  return {
    result: {
      promptInputPath: showcasePromptInputArtifact.path,
      responseRawPath: showcaseResponseArtifact.path,
      validationPath: showcaseValidationArtifactPath,
      warning: showcaseWarning,
      showcase: {
        available: Boolean(showcaseHtmlArtifactPath),
        canonicalUrl: showcaseBase.canonicalUrl,
        latestUrl: showcaseBase.latestUrl,
        htmlPath: showcaseHtmlArtifactPath,
        validationPath: showcaseValidationArtifactPath,
        warning: showcaseWarning,
      },
      query: {
        maxTurns: 0,
        timeoutMs: 0,
        durationMs: queryDurationMs,
        failed: queryFailed,
        failureReason: queryFailureReason,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        totalTokens: totalInputTokens + totalOutputTokens,
      },
    },
    artifacts,
  };
}
