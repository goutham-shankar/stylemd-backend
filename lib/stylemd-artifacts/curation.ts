import { copyFile, mkdir, rm, stat } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { query, type HookCallback, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { summarizeForLog } from "@/lib/utils/logging";
import { emitEvent } from "@/lib/store/stylemdSessionStore";
import type { PlaygroundEvent } from "@/lib/types/stylemdEvents";
import {
  appendStyleMdLogLine,
  getStyleMdRunDir,
  writeStyleMdJson,
  writeStyleMdText,
} from "@/lib/stylemd-artifacts/artifacts";
import {
  resolveStyleMdRuntimeConfig,
  type StyleMdRuntimeConfig,
} from "@/lib/stylemd-artifacts/provider";
import {
  assertNotAborted,
  errorToMessage,
  nowIso,
} from "@/lib/stylemd-artifacts/helpers";
import type {
  StyleMdArtifactRecord,
  StyleMdComponentEntry,
  StyleMdCurateResult,
  StyleMdCurationDecision,
  StyleMdCuratedManifest,
  StyleMdCuratedUnit,
} from "@/lib/stylemd-artifacts/types";
import { runKimiCurationQuery } from "@/lib/kimi/curation";

// Token tracking for queries
const tokenUsageMap = new Map<string, { inputTokens: number; outputTokens: number }>();

function storeTokenUsage(runId: string, queryLabel: string, inputTokens: number, outputTokens: number): void {
  const key = `${runId}::${queryLabel}`;
  tokenUsageMap.set(key, { inputTokens, outputTokens });
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

type CurationPromptInput = {
  run_id: string;
  url: string;
  generated_at: string;
  run_dir: string;
  full_screenshot: string;
  dedup_manifest: string;
  component_count: number;
  component_ids: string[];
  components: Array<{
    component_id: string;
    selector: string;
    tag_name: string;
    rect: StyleMdComponentEntry["rect"];
    files?: {
      screenshot: string;
      metadata: string;
      dom_agent: string;
      styles_agent: string;
      style_tree_agent: string;
      pseudo_agent: string;
    };
  }>;
};

type RunCurateInput = {
  runId: string;
  url: string;
  dedupAgentManifestPath: string;
  components: StyleMdComponentEntry[];
  signal: AbortSignal;
  runtime?: StyleMdRuntimeConfig;
  runClaudeQuery?: ClaudeCurationQuery;
};

type ClaudeCurationQueryInput = {
  runId: string;
  workspaceDir: string;
  runtime: StyleMdRuntimeConfig;
  systemPrompt: string;
  prompt: string;
  signal: AbortSignal;
  queryLabel?: string;
};

type ClaudeCurationQuery = (input: ClaudeCurationQueryInput) => Promise<string>;

type ParsedCurationResponse = {
  decisions: StyleMdCurationDecision[];
  jsonCandidate: string;
};

type ApplyCurationInput = {
  runId: string;
  url: string;
  sourceManifestPath: string;
  decisions: StyleMdCurationDecision[];
  components: StyleMdComponentEntry[];
};

const CURATION_ALLOWED_TOOLS = ["Read", "Grep", "Glob", "LS"];
const CURATION_QUERY_TIMEOUT_MS = 600_000;
const CURATION_MAX_READ_BYTES = 50_000;

type ApplyCurationOptions = {
  deleteDirectory?: (directory: string) => Promise<void>;
};

type ApplyCurationResult = {
  curatedManifest: StyleMdCuratedManifest;
  keptComponentIds: string[];
  deletedComponentIds: string[];
  deletedDirectories: string[];
};

const singleDecisionSchema = z.object({
  type: z.literal("single"),
  component_id: z.string(),
  study_label: z.string(),
  reason: z.string(),
});

const mergeDecisionSchema = z.object({
  type: z.literal("merge"),
  component_ids: z.tuple([z.string(), z.string()]),
  study_label: z.string(),
  reason: z.string(),
});

const curationResponseSchema = z.object({
  units: z.array(z.union([singleDecisionSchema, mergeDecisionSchema])).min(1),
});

function trimRequired(value: string, fieldName: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Missing required field: ${fieldName}`);
  }
  return trimmed;
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

function truncateForError(value: string, maxChars = 1000): string {
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

export function extractJsonCandidate(text: string): string {
  // Try fenced JSON blocks first
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    const candidate = fenced[1].trim();
    // Validate that it has balanced braces
    if (hasBalancedBraces(candidate)) {
      return candidate;
    }
  }

  // Try to find JSON object {...}
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const candidate = text.slice(firstBrace, lastBrace + 1).trim();
    if (hasBalancedBraces(candidate)) {
      return candidate;
    }
  }

  // Try to find JSON array [...]
  const firstBracket = text.indexOf("[");
  const lastBracket = text.lastIndexOf("]");
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    const candidate = text.slice(firstBracket, lastBracket + 1).trim();
    if (hasBalancedBraces(candidate)) {
      return candidate;
    }
  }

  // Fallback: return trimmed text (will likely fail to parse, but gives better error context)
  return text.trim();
}

/**
 * Check if a string has balanced braces and brackets
 */
function hasBalancedBraces(text: string): boolean {
  let braceCount = 0;
  let bracketCount = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === "\\") {
      escapeNext = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === "{") braceCount++;
      if (char === "}") braceCount--;
      if (char === "[") bracketCount++;
      if (char === "]") bracketCount--;
    }
  }

  return braceCount === 0 && bracketCount === 0;
}

export function validateStyleMdCurationDecisions(
  response: unknown,
  allowedComponentIds: Set<string>,
): StyleMdCurationDecision[] {
  const parsed = curationResponseSchema.parse(response);
  const seen = new Set<string>();
  const decisions: StyleMdCurationDecision[] = [];

  for (const unit of parsed.units) {
    const studyLabel = trimRequired(unit.study_label, "study_label");
    const reason = trimRequired(unit.reason, "reason");

    if (unit.type === "single") {
      const componentId = trimRequired(unit.component_id, "component_id");
      if (!allowedComponentIds.has(componentId)) {
        throw new Error(`Unknown component id: ${componentId}`);
      }
      if (seen.has(componentId)) {
        throw new Error(`Component appears in multiple units: ${componentId}`);
      }

      seen.add(componentId);
      decisions.push({
        type: "single",
        component_id: componentId,
        study_label: studyLabel,
        reason,
      });
      continue;
    }

    const firstId = trimRequired(unit.component_ids[0], "component_ids[0]");
    const secondId = trimRequired(unit.component_ids[1], "component_ids[1]");

    if (firstId === secondId) {
      throw new Error(`Merge unit must contain two distinct component ids: ${firstId}`);
    }

    for (const componentId of [firstId, secondId]) {
      if (!allowedComponentIds.has(componentId)) {
        throw new Error(`Unknown component id: ${componentId}`);
      }
      if (seen.has(componentId)) {
        throw new Error(`Component appears in multiple units: ${componentId}`);
      }
      seen.add(componentId);
    }

    decisions.push({
      type: "merge",
      component_ids: [firstId, secondId],
      study_label: studyLabel,
      reason,
    });
  }

  return decisions;
}

export function parseAndValidateStyleMdCurationResponse(
  rawText: string,
  allowedComponentIds: Set<string>,
): ParsedCurationResponse {
  // Handle empty response early
  if (!rawText || rawText.trim().length === 0) {
    throw new Error("KIMI returned empty response. This may indicate: 1) Rate limit hit silently, 2) API timeout, or 3) Response truncation. Check KIMI logs.");
  }

  const jsonCandidate = extractJsonCandidate(rawText);

  // Add comprehensive error handling with debugging context
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(jsonCandidate) as unknown;
  } catch (parseError) {
    const errorMsg = parseError instanceof Error ? parseError.message : String(parseError);
    
    // Log debugging information for incomplete/malformed JSON
    console.error(`❌ [CURATION] JSON parsing failed: ${errorMsg}`);
    console.error(`   Raw response length: ${rawText.length} characters`);
    console.error(`   Extracted JSON length: ${jsonCandidate.length} characters`);
    console.error(`   Raw response (first 300): ${rawText.slice(0, 300)}`);
    console.error(`   Extracted JSON (first 300): ${jsonCandidate.slice(0, 300)}`);
    
    // Check for common issues
    if (jsonCandidate.length === 0) {
      if (rawText.length === 0) {
        throw new Error("KIMI response was completely empty - possible rate limit, timeout, or API error");
      }
      throw new Error(`JSON extraction failed: no JSON found in response. Raw: ${rawText.slice(0, 500)}`);
    }
    
    if (!jsonCandidate.includes("{") && !jsonCandidate.includes("[")) {
      throw new Error(`JSON extraction failed: no braces found. Response: ${rawText.slice(0, 500)}`);
    }

    throw new Error(`JSON parsing failed: ${errorMsg}. Extracted: ${jsonCandidate.slice(0, 300)}`);
  }

  const decisions = validateStyleMdCurationDecisions(parsedJson, allowedComponentIds);
  return {
    decisions,
    jsonCandidate,
  };
}

function toRunRelative(runDir: string, absolutePath: string): string {
  const value = relative(runDir, absolutePath);
  return value.split("\\").join("/");
}

/**
 * OPTIMIZATION: Pre-filter components using simple heuristics to reduce AI analysis load
 * Skips obviously unwanted components like popups, modals, and invisible elements
 * This can reduce component set by 30-50% without AI, saving significant tokens
 */
function preFilterComponents(components: StyleMdComponentEntry[]): StyleMdComponentEntry[] {
  // If already small, skip filtering to preserve all data
  if (components.length <= 30) {
    return components;
  }

  const filtered = components.filter((component) => {
    const selector = component.selector.toLowerCase();
    const tagName = component.tagName.toLowerCase();
    
    // FILTER: Skip obvious popups/modals/overlays by selector pattern
    const popupPatterns = [
      "modal", "popup", "overlay", "dialog", "drawer", "sheet",
      "toast", "notification", "cookie", "banner", "consent",
      "ad", "advertisement", "advert", "sidebar-menu", "sidenav"
    ];
    
    if (popupPatterns.some(pattern => 
      selector.includes(pattern) || 
      tagName.includes(pattern)
    )) {
      return false;
    }

    // FILTER: Skip invisible components (height or width near zero)
    if (component.rect.width < 10 && component.rect.height < 10) {
      return false;
    }

    // FILTER: Skip tiny components unlikely to be reusable patterns
    const area = component.rect.width * component.rect.height;
    if (area < 100) {
      return false;
    }

    // Keep everything else
    return true;
  });

  const skipped = components.length - filtered.length;
  if (skipped > 0) {
    console.log(`   📊 [OPTIMIZATION] Pre-filtered ${skipped}/${components.length} components (${Math.round(skipped/components.length*100)}% reduction)`);
  }

  return filtered.length > 0 ? filtered : components; // Fallback to all if filtering removes everything
}

function buildPromptInput(input: {
  runId: string;
  url: string;
  runDir: string;
  dedupAgentManifestPath: string;
  components: StyleMdComponentEntry[];
}): CurationPromptInput {
  const { runId, url, runDir, dedupAgentManifestPath, components } = input;

  // OPTIMIZATION: Minimize prompt size by only including essential component metadata
  // File paths are not needed in prompt - AI can read manifest.agent.json instead
  return {
    run_id: runId,
    url,
    generated_at: nowIso(),
    run_dir: ".",
    full_screenshot: "full_screenshot.png",
    dedup_manifest: toRunRelative(runDir, dedupAgentManifestPath),
    component_count: components.length,
    component_ids: components.map((component) => component.componentId),
    // OPTIMIZATION: Exclude redundant file paths - reduce from ~6 paths per component to 0
    // AI can read components_manifest.agent.json which has all file references
    components: components.map((component) => ({
      component_id: component.componentId,
      selector: component.selector,
      tag_name: component.tagName,
      rect: component.rect,
      // Removed: files object with all 6 file paths (saves ~400+ tokens for 50+ components)
    })),
  };
}

function buildDecisionPrompt(promptInput: CurationPromptInput): string {
  return [
    "Select final curated study units for faithful website reconstruction.",
    "Working directory points to an isolated agent workspace with approved files only.",
    "",
    "Inspect these artifacts as needed:",
    "- full_screenshot.png",
    "- components/components_manifest.agent.json",
    "- selected component files under components/<component_id>/",
    "",
    "Tool constraints:",
    "- for large text files, use Read with non-negative offset + limit windows",
    "",
    "Decision priorities:",
    "- preserve reconstruction-critical layout/composition patterns",
    "- prefer clean representative components",
    "- avoid redundant near-duplicates unless structurally different",
    "- downweight popup/modal/chat/cookie contamination unless no clean alternative exists",
    "- merge only when exactly two components are jointly required for one reusable pattern",
    "",
    "Output rules:",
    "1. Output must be strict JSON and nothing else.",
    "2. Output schema:",
    "{",
    '  "units": [',
    '    {"type":"single","component_id":"<id>","study_label":"...","reason":"..."},',
    '    {"type":"merge","component_ids":["<idA>","<idB>"],"study_label":"...","reason":"..."}',
    "  ]",
    "}",
    "3. merge must include exactly two distinct component IDs.",
    "4. Each component ID may appear at most once globally across all units.",
    "5. Omitted components will be deleted.",
    "6. Keep study_label concise and reason short.",
    "",
    "Prompt context (JSON):",
    JSON.stringify(promptInput, null, 2),
  ].join("\n");
}

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
  const normalized = candidatePath.replace(/\\/g, "/");
  return (
    normalized.includes(".raw.") ||
    normalized.endsWith("components_manifest.raw.json") ||
    normalized.endsWith("components_manifest.deduped.json") ||
    normalized.endsWith("components_manifest.curated.json")
  );
}

function isBinaryFile(filePath: string): boolean {
  const normalized = filePath.toLowerCase().replace(/\\/g, "/");
  const binaryExtensions = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svg", ".zip", ".gz", ".tar"];
  return binaryExtensions.some((ext) => normalized.endsWith(ext));
}

function hasReadWindow(toolInput: unknown): boolean {
  if (!toolInput || typeof toolInput !== "object") {
    return false;
  }
  const input = toolInput as Record<string, unknown>;
  return typeof input.offset === "number" || typeof input.limit === "number";
}

function createPreToolUsePathGuard(input: {
  runId: string;
  workspaceDir: string;
}): HookCallback {
  const { runId, workspaceDir } = input;

  return async (hookInput) => {
    if (hookInput.hook_event_name !== "PreToolUse") {
      return { continue: true };
    }

    if (!CURATION_ALLOWED_TOOLS.includes(hookInput.tool_name)) {
      const reason = `Blocked tool '${hookInput.tool_name}' in raw-safe mode. Allowed tools: ${CURATION_ALLOWED_TOOLS.join(", ")}.`;
      emitObservedStyleMdEvent(runId, {
        type: "stylemd_action",
        source: "system",
        runId,
        stage: "curate",
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
        const reason = `Blocked path '${candidate}' outside raw-safe curation workspace.`;
        emitObservedStyleMdEvent(runId, {
          type: "stylemd_action",
          source: "system",
          runId,
          stage: "curate",
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
                  stage: "curate",
                  level: "warn",
                  message: reason,
                });
                return {
                  continue: false,
                  decision: "block",
                  reason,
                };
              }
              if (fileStat.size > CURATION_MAX_READ_BYTES) {
                const reason = `Blocked oversized read '${candidate}' (${fileStat.size} bytes). Re-run Read with offset/limit windows.`;
                emitObservedStyleMdEvent(runId, {
                  type: "stylemd_action",
                  source: "system",
                  runId,
                  stage: "curate",
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
            // Missing files should surface through the underlying tool result.
          }
        }
      }
    }

    return { continue: true };
  };
}

async function prepareCurateWorkspace(input: {
  runDir: string;
  dedupAgentManifestPath: string;
  components: StyleMdComponentEntry[];
}): Promise<string> {
  const { runDir, dedupAgentManifestPath, components } = input;
  const workspaceDir = join(runDir, "agent_workspace", "curate");
  await rm(workspaceDir, { recursive: true, force: true });
  await mkdir(workspaceDir, { recursive: true });

  const files = new Set<string>([
    join(runDir, "full_screenshot.png"),
    dedupAgentManifestPath,
  ]);

  for (const component of components) {
    files.add(component.screenshotPath);
    files.add(component.metadataPath);
    files.add(component.agentDomPath);
    files.add(component.agentStylesPath);
    files.add(component.agentStyleTreePath);
    files.add(component.agentPseudoStylesPath);
  }

  for (const sourcePath of files) {
    const rel = toRunRelative(runDir, sourcePath);
    const destination = join(workspaceDir, rel);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(sourcePath, destination);
  }

  return workspaceDir;
}

function computeDeterministicFallbackDecisions(
  components: StyleMdComponentEntry[],
): StyleMdCurationDecision[] {
  if (components.length === 0) {
    return [];
  }

  const sorted = [...components].sort((a, b) => {
    if (a.rect.top !== b.rect.top) {
      return a.rect.top - b.rect.top;
    }
    if (a.rect.left !== b.rect.left) {
      return a.rect.left - b.rect.left;
    }
    return a.componentId.localeCompare(b.componentId);
  });

  const targetCount = Math.min(12, Math.max(6, Math.ceil(sorted.length * 0.4)));
  const keptCount = Math.min(sorted.length, targetCount);

  if (keptCount === sorted.length) {
    return sorted.map((component, index) => ({
      type: "single",
      component_id: component.componentId,
      study_label: `Fallback Unit ${String(index + 1).padStart(2, "0")}`,
      reason: "Deterministic fallback selected this component to preserve coverage.",
    }));
  }

  const selectedIndexes = new Set<number>();
  const denominator = Math.max(1, keptCount - 1);

  for (let i = 0; i < keptCount; i += 1) {
    const index = Math.round((i * (sorted.length - 1)) / denominator);
    selectedIndexes.add(index);
  }

  const selected = [...selectedIndexes]
    .sort((a, b) => a - b)
    .map((index) => sorted[index])
    .filter((value, index, array) => array.findIndex((item) => item.componentId === value.componentId) === index);

  return selected.map((component, index) => ({
    type: "single",
    component_id: component.componentId,
    study_label: `Fallback Unit ${String(index + 1).padStart(2, "0")}`,
    reason: "Deterministic fallback selected this component to preserve vertical coverage.",
  }));
}

async function runClaudeCurationQuery(input: ClaudeCurationQueryInput): Promise<string> {
  const {
    runId,
    workspaceDir,
    runtime,
    systemPrompt,
    prompt,
    signal,
  } = input;
  const providerLabel = runtime.provider === "kimi" ? "Kimi" : "Claude";
  const stageTag = buildStageTag(runId, "curate");

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
  });

  const preToolUseHook: HookCallback = async (hookInput) => {
    const guardDecision = await preToolPathGuard(hookInput, undefined, { signal: abortController.signal });
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

  const stream = query({
    prompt,
    options: {
      abortController,
      cwd: workspaceDir,
      model: runtime.queryModel,
      env: runtime.env,
      systemPrompt,
      includePartialMessages: true,
      settingSources: [],
      tools: {
        type: "preset",
        preset: "claude_code",
      },
      mcpServers: {},
      disallowedTools: ["WebSearch", "WebFetch", "Bash", "Edit", "Write", "MultiEdit"],
      allowedTools: CURATION_ALLOWED_TOOLS,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      hooks: {
        PreToolUse: [{ hooks: [preToolUseHook] }],
        PostToolUse: [{ hooks: [postToolUseHook] }],
        PostToolUseFailure: [{ hooks: [postToolUseFailureHook] }],
      },
    },
  });

  let finalText = "";
  let streamedText = "";
  let timedOut = false;
  const timeoutTimer = setTimeout(() => {
    timedOut = true;
    abortController.abort();
  }, CURATION_QUERY_TIMEOUT_MS);

  try {
    for await (const message of stream) {
      const deltaText = extractDeltaText(message);
      if (deltaText) {
        streamedText += deltaText;
        emitObservedStyleMdEvent(runId, {
          type: "assistant_message_delta",
          source: "agent",
          delta: `${stageTag}\u2063${deltaText}`,
        });
      }

      const assistantText = extractAssistantText(message);
      if (assistantText) {
        finalText = assistantText;
      }

      if (message.type === "result" && "result" in message && typeof message.result === "string" && message.result.trim()) {
        finalText = message.result.trim();
      }

      if (message.type === "result" && message.is_error) {
        throw new Error(`${providerLabel} curation query failed (${message.subtype}): ${getResultFailureDetail(message)}`);
      }
    }
  } finally {
    clearTimeout(timeoutTimer);
    signal.removeEventListener("abort", onAbort);
    stream.close();
  }

  const mergedText = finalText.trim() || streamedText.trim();
  if (timedOut) {
    throw new Error(`${providerLabel} curation query timed out after ${CURATION_QUERY_TIMEOUT_MS}ms.`);
  }
  if (!mergedText) {
    throw new Error(`${providerLabel} curation returned no text.`);
  }

  const transcriptText =
    mergedText.length > 10_000 ? `${mergedText.slice(0, 10_000)}\n...[truncated stylemd curate output]` : mergedText;
  emitObservedStyleMdEvent(runId, {
    type: "assistant_final_message",
    source: "agent",
    text: `${stageTag}\n${transcriptText}`,
  });

  return mergedText;
}

export async function applyStyleMdCurationDecisions(
  input: ApplyCurationInput,
  options: ApplyCurationOptions = {},
): Promise<ApplyCurationResult> {
  const { runId, url, sourceManifestPath, decisions, components } = input;
  const deleteDirectory = options.deleteDirectory ?? (async (directory: string) => {
    await rm(directory, { recursive: true, force: true });
  });

  const componentById = new Map<string, StyleMdComponentEntry>();
  for (const component of components) {
    componentById.set(component.componentId, component);
  }

  const units: StyleMdCuratedUnit[] = decisions.map((decision, index) => {
    const unitId = `unit_${String(index + 1).padStart(3, "0")}`;

    if (decision.type === "single") {
      const component = componentById.get(decision.component_id);
      if (!component) {
        throw new Error(`Cannot apply curation: missing component ${decision.component_id}`);
      }

      return {
        unit_id: unitId,
        type: "single",
        component_ids: [decision.component_id],
        study_label: decision.study_label,
        reason: decision.reason,
        components: [component],
      };
    }

    const first = componentById.get(decision.component_ids[0]);
    const second = componentById.get(decision.component_ids[1]);
    if (!first || !second) {
      throw new Error(`Cannot apply curation: missing merge components ${decision.component_ids.join(", ")}`);
    }

    return {
      unit_id: unitId,
      type: "merge",
      component_ids: [decision.component_ids[0], decision.component_ids[1]],
      study_label: decision.study_label,
      reason: decision.reason,
      components: [first, second],
    };
  });

  const keptSet = new Set<string>();
  for (const unit of units) {
    for (const componentId of unit.component_ids) {
      keptSet.add(componentId);
    }
  }

  const keptComponentIds = components
    .map((component) => component.componentId)
    .filter((componentId) => keptSet.has(componentId));

  const deletedComponents = components.filter((component) => !keptSet.has(component.componentId));
  const deletedComponentIds = deletedComponents.map((component) => component.componentId);
  const deletedDirectories: string[] = [];

  for (const component of deletedComponents) {
    await deleteDirectory(component.directory);
    deletedDirectories.push(component.directory);
  }

  const curatedManifest: StyleMdCuratedManifest = {
    run_id: runId,
    url,
    curated_at: nowIso(),
    source_manifest_path: sourceManifestPath,
    units,
    kept_component_ids: keptComponentIds,
    deleted_component_ids: deletedComponentIds,
  };

  return {
    curatedManifest,
    keptComponentIds,
    deletedComponentIds,
    deletedDirectories,
  };
}

export async function runCurateStage(input: RunCurateInput): Promise<StageOutput<StyleMdCurateResult>> {
  const { runId, url, dedupAgentManifestPath, components, signal } = input;
  const runtime = input.runtime ?? resolveStyleMdRuntimeConfig("claude");
  
  // Select query function based on provider
  let runClaudeQuery = input.runClaudeQuery ?? runClaudeCurationQuery;
  if (runtime.provider === "kimi") {
    console.log(`🎯 [STYLEMD] Using KIMI provider for curation stage`);
    // Adapt Kimi query function to Claude query interface when no test override is supplied.
    if (!input.runClaudeQuery) {
      runClaudeQuery = async (queryInput: ClaudeCurationQueryInput) => {
        return runKimiCurationQuery({
          runId: queryInput.runId,
          workspaceDir: queryInput.workspaceDir,
          runtime: queryInput.runtime,
          systemPrompt: queryInput.systemPrompt,
          prompt: queryInput.prompt,
          signal: queryInput.signal,
          queryLabel: queryInput.queryLabel,
          onTokenUsage: (inputTokens, outputTokens) => {
            storeTokenUsage(queryInput.runId, queryInput.queryLabel ?? "curate-decision", inputTokens, outputTokens);
          },
        });
      };
    }
  } else {
    console.log(`🎯 [STYLEMD] Using CLAUDE provider for curation stage`);
  }
  
  const providerLabel = runtime.provider === "kimi" ? "Kimi" : "Claude";
  const runDir = getStyleMdRunDir(runId);
  const artifacts: StyleMdArtifactRecord[] = [];

  assertNotAborted(signal);

  // OPTIMIZATION: Pre-filter components to reduce token usage
  const filteredComponents = preFilterComponents(components);
  
  const promptInput = buildPromptInput({
    runId,
    url,
    runDir,
    dedupAgentManifestPath,
    components: filteredComponents,
  });

  const promptInputArtifact = await writeStyleMdJson(runId, join("curation", "prompt_input.json"), promptInput);
  artifacts.push(promptInputArtifact);
  const stageTag = buildStageTag(runId, "curate");

  if (filteredComponents.length === 0) {
    emitObservedStyleMdEvent(runId, {
      type: "stylemd_action",
      source: "system",
      runId,
      stage: "curate",
      level: "warn",
      message: `No deduped components available. Skipping ${providerLabel} curation.`,
    });
    const responseRawArtifact = await writeStyleMdText(
      runId,
      join("curation", "response.raw.txt"),
      "No deduped components available. Claude curation skipped.\n",
      "text",
    );
    const parsedArtifact = await writeStyleMdJson(runId, join("curation", "decisions.parsed.json"), {
      ok: true,
      skipped: true,
      units: [],
    });

    const applied = await applyStyleMdCurationDecisions({
      runId,
      url,
      sourceManifestPath: dedupAgentManifestPath,
      decisions: [],
      components,
    });

    const curatedManifestArtifact = await writeStyleMdJson(
      runId,
      join("components", "components_manifest.curated.json"),
      applied.curatedManifest,
    );
    const appliedArtifact = await writeStyleMdJson(runId, join("curation", "decisions.applied.json"), {
      ok: true,
      skipped: true,
      curated_manifest_path: curatedManifestArtifact.path,
      kept_component_ids: [],
      deleted_component_ids: [],
    });

    artifacts.push(
      responseRawArtifact,
      parsedArtifact,
      curatedManifestArtifact,
      appliedArtifact,
    );

    return {
      result: {
        curatedManifestPath: curatedManifestArtifact.path,
        promptInputPath: promptInputArtifact.path,
        responseRawPath: responseRawArtifact.path,
        decisionsParsedPath: parsedArtifact.path,
        decisionsAppliedPath: appliedArtifact.path,
        curatedManifest: applied.curatedManifest,
        keptComponentIds: [],
        deletedComponentIds: [],
      },
      artifacts,
    };
  }

  const allowedIds = new Set(filteredComponents.map((component) => component.componentId));
  const systemPrompt = [
    "You are a deterministic curation engine for style artifact studies.",
    "Use read-only tools to inspect files in the isolated workspace only.",
    "Do not modify or create files.",
    "Select final study units using only workspace artifacts.",
    "Return strict JSON only.",
  ].join("\n");
  emitObservedStyleMdEvent(runId, {
    type: "stylemd_action",
    source: "system",
    runId,
    stage: "curate",
    level: "info",
    message: `Starting single-pass ${providerLabel} curation.`,
    detail: {
      max_turns: null,
      timeout_ms: CURATION_QUERY_TIMEOUT_MS,
      component_count: filteredComponents.length,
    },
  });

  let parsed: ParsedCurationResponse | null = null;
  let lastDecisionRaw = "";
  let queryError: string | undefined;
  const decisionPrompt = buildDecisionPrompt(promptInput);
  const workspaceDir = await prepareCurateWorkspace({
    runDir,
    dedupAgentManifestPath,
    components: filteredComponents,
  });
  const queryStartedAt = Date.now();

  try {
    const decisionRaw = await runClaudeQuery({
      runId,
      workspaceDir,
      runtime,
      systemPrompt,
      prompt: decisionPrompt,
      signal,
      queryLabel: "curate-decision",
    });
    lastDecisionRaw = decisionRaw;
    parsed = parseAndValidateStyleMdCurationResponse(decisionRaw, allowedIds);
  } catch (error) {
    queryError = errorToMessage(error);
    // Add detailed error context for debugging
    console.error(`\n❌ [CURATION] Query failed with error: ${queryError}`);
    console.error(`   Response received (${lastDecisionRaw.length} chars): ${lastDecisionRaw.slice(0, 300)}`);
  }
  const queryDurationMs = Date.now() - queryStartedAt;

  let decisions: StyleMdCurationDecision[] = [];
  let source: "claude" | "deterministic_fallback" = "claude";

  if (parsed) {
    decisions = parsed.decisions;
  } else {
    source = "deterministic_fallback";
    decisions = computeDeterministicFallbackDecisions(filteredComponents);
    emitObservedStyleMdEvent(runId, {
      type: "stylemd_action",
      source: "system",
      runId,
      stage: "curate",
      level: "warn",
      message: `${providerLabel} curation failed validation/query. Applied deterministic fallback curation.`,
      detail: {
        error: queryError ?? `Invalid ${providerLabel} JSON response.`,
        selected_components: decisions.length,
        total_components: filteredComponents.length,
      },
    });
  }

  const responseRawArtifact = await writeStyleMdText(
    runId,
    join("curation", "response.raw.txt"),
    `${lastDecisionRaw || `Query error: ${queryError ?? "No Claude response."}`}\n`,
    "text",
  );
  artifacts.push(responseRawArtifact);

  const parsedArtifact = await writeStyleMdJson(runId, join("curation", "decisions.parsed.json"), {
    ok: source === "claude",
    source,
    attempts: 1,
    query: {
      max_turns: null,
      timeout_ms: CURATION_QUERY_TIMEOUT_MS,
      duration_ms: queryDurationMs,
      failed: Boolean(queryError),
      failure_reason: queryError,
    },
    json_candidate: parsed?.jsonCandidate,
    units: decisions,
  });
  artifacts.push(parsedArtifact);

  const applied = await applyStyleMdCurationDecisions({
    runId,
    url,
    sourceManifestPath: dedupAgentManifestPath,
    decisions,
    components: filteredComponents,
  });

  const curatedManifestArtifact = await writeStyleMdJson(
    runId,
    join("components", "components_manifest.curated.json"),
    applied.curatedManifest,
  );
  const appliedArtifact = await writeStyleMdJson(runId, join("curation", "decisions.applied.json"), {
    ok: true,
    source,
    attempts: 1,
    kept_component_ids: applied.keptComponentIds,
    deleted_component_ids: applied.deletedComponentIds,
    deleted_directories: applied.deletedDirectories,
    curated_manifest_path: curatedManifestArtifact.path,
    query: {
      max_turns: null,
      timeout_ms: CURATION_QUERY_TIMEOUT_MS,
      duration_ms: queryDurationMs,
      failed: Boolean(queryError),
      failure_reason: queryError,
    },
  });
  artifacts.push(curatedManifestArtifact, appliedArtifact);

  emitObservedStyleMdEvent(runId, {
    type: "stylemd_action",
    source: "system",
    runId,
    stage: "curate",
    level: "info",
    message: "Curation applied.",
    detail: {
      source,
      kept: applied.keptComponentIds.length,
      deleted: applied.deletedComponentIds.length,
      tag: stageTag,
    },
  });

  return {
    result: {
      curatedManifestPath: curatedManifestArtifact.path,
      promptInputPath: promptInputArtifact.path,
      responseRawPath: responseRawArtifact.path,
      decisionsParsedPath: parsedArtifact.path,
      decisionsAppliedPath: appliedArtifact.path,
      curatedManifest: applied.curatedManifest,
      keptComponentIds: applied.keptComponentIds,
      deletedComponentIds: applied.deletedComponentIds,
    },
    artifacts,
  };
}
