export const STYLEMD_PIPELINE_STAGES = ["capture", "extract", "dedup", "curate", "styleguide"] as const;

export type StyleMdPipelineStageName = (typeof STYLEMD_PIPELINE_STAGES)[number];
export type StyleMdProvider = "claude" | "kimi";

export type StyleMdRunStatus = "running" | "completed" | "completed_with_warnings" | "failed" | "canceled";

export type StyleMdStageStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export type StyleMdArtifactKind = "json" | "image" | "html" | "css" | "text" | "binary";

export interface StyleMdArtifactRecord {
  name: string;
  path: string;
  kind: StyleMdArtifactKind;
  sizeBytes?: number;
}

export interface StyleMdStageState {
  stage: StyleMdPipelineStageName;
  status: StyleMdStageStatus;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  error?: string;
}

export interface StyleMdComponentRect {
  top: number;
  left: number;
  width: number;
  height: number;
  bottom: number;
}

export interface StyleMdCandidate {
  candidateId: string;
  selector: string;
  tagName: string;
  rect: StyleMdComponentRect;
  childrenCount: number;
  textLength: number;
}

export interface StyleMdComponentEntry {
  componentId: string;
  candidateId: string;
  selector: string;
  tagName: string;
  rect: StyleMdComponentRect;
  directory: string;
  screenshotPath: string;
  metadataPath: string;
  domPath: string;
  stylesPath: string;
  styleTreePath: string;
  pseudoStylesPath: string;
  cssRuleRefsPath: string;
  agentDomPath: string;
  agentStylesPath: string;
  agentStyleTreePath: string;
  agentPseudoStylesPath: string;
  duplicateOf?: string;
}

export interface StyleMdStylesheetFetchRecord {
  id: string;
  href: string;
  status: "fetched" | "failed";
  statusCode?: number;
  error?: string;
  artifactPath?: string;
}

export interface StyleMdStylesheetBundle {
  inlineStyles: Array<{
    id: string;
    artifactPath: string;
  }>;
  linkedStyles: StyleMdStylesheetFetchRecord[];
  stylesheetInventory: Array<{
    id: string;
    href: string | null;
    media: string;
    disabled: boolean;
    title: string | null;
    ownerNodeName: string | null;
    readableRuleCount: number | null;
  }>;
  fontsManifestPath?: string;
  fontsLocalCssPath?: string;
}

export interface StyleMdFontManifestEntry {
  id: string;
  family: string;
  weight: string;
  style: string;
  originalSource: string;
  resolvedSource: string;
  localArtifactPath?: string;
  mimeType?: string;
  format?: string;
  hash?: string;
  status: "localized" | "failed";
  error?: string;
}

export interface StyleMdFontManifest {
  run_id: string;
  generated_at: string;
  entries: StyleMdFontManifestEntry[];
  local_css_path: string;
  families: Array<{
    family: string;
    localized_sources: number;
  }>;
}

export interface StyleMdCaptureResult {
  fullScreenshotPath: string;
  viewport: {
    width: number;
    height: number;
    deviceScaleFactor: number;
  };
  documentHeight: number;
}

export interface StyleMdExtractResult {
  candidatesPath: string;
  rawManifestPath: string;
  pageStylesPath: string;
  fontsManifestPath: string;
  fontsLocalCssPath: string;
  components: StyleMdComponentEntry[];
  candidateCount: number;
}

export interface StyleMdDuplicatePair {
  canonicalComponentId: string;
  duplicateComponentId: string;
  score: number;
}

export interface StyleMdDedupResult {
  dedupManifestPath: string;
  dedupAgentManifestPath: string;
  duplicatesPath: string;
  deletedComponentIds: string[];
  duplicatePairs: StyleMdDuplicatePair[];
  keptComponents: StyleMdComponentEntry[];
}

export type StyleMdBreakpointName = "desktop" | "tablet" | "mobile";

export interface StyleMdComponentResponsiveCapture {
  component_id: string;
  selector: string;
  found: boolean;
  default_screenshot?: string;
  hover_screenshot?: string;
  hover_method?: "cdp_force_pseudo" | "playwright_hover" | "none";
  error?: string;
}

export interface StyleMdUnitResponsiveCapture {
  unit_id: string;
  components: StyleMdComponentResponsiveCapture[];
}

export interface StyleMdResponsiveHoverEvidence {
  run_id: string;
  url: string;
  generated_at: string;
  breakpoints: Array<{
    name: StyleMdBreakpointName;
    viewport: {
      width: number;
      height: number;
    };
    units: StyleMdUnitResponsiveCapture[];
  }>;
}

export interface StyleMdCurationSingleDecision {
  type: "single";
  component_id: string;
  study_label: string;
  reason: string;
}

export interface StyleMdCurationMergeDecision {
  type: "merge";
  component_ids: [string, string];
  study_label: string;
  reason: string;
}

export type StyleMdCurationDecision = StyleMdCurationSingleDecision | StyleMdCurationMergeDecision;

export interface StyleMdCuratedSingleUnit {
  unit_id: string;
  type: "single";
  component_ids: [string];
  study_label: string;
  reason: string;
  components: [StyleMdComponentEntry];
}

export interface StyleMdCuratedMergeUnit {
  unit_id: string;
  type: "merge";
  component_ids: [string, string];
  study_label: string;
  reason: string;
  components: [StyleMdComponentEntry, StyleMdComponentEntry];
}

export type StyleMdCuratedUnit = StyleMdCuratedSingleUnit | StyleMdCuratedMergeUnit;

export interface StyleMdCuratedManifest {
  run_id: string;
  url: string;
  curated_at: string;
  source_manifest_path: string;
  units: StyleMdCuratedUnit[];
  kept_component_ids: string[];
  deleted_component_ids: string[];
}

export interface StyleMdCurateResult {
  curatedManifestPath: string;
  promptInputPath: string;
  responseRawPath: string;
  decisionsParsedPath: string;
  decisionsAppliedPath: string;
  curatedManifest: StyleMdCuratedManifest;
  keptComponentIds: string[];
  deletedComponentIds: string[];
}

export interface StyleMdParsedUnitReconstruction {
  role: string;
  structure: string;
  box: string;
  typography: string;
  surface: string;
  placement: string;
  hover: string;
  responsive: string;
  notes: string;
}

export interface StyleMdParsedUnit {
  unit_id: string;
  study_label: string;
  section_intent: string;
  layout_pattern: string;
  component_ids: string[];
  reconstruction: StyleMdParsedUnitReconstruction;
}

export interface StyleMdParsedUnitsManifest {
  run_id: string;
  url: string;
  parsed_at: string;
  source_curated_manifest_path: string;
  units: StyleMdParsedUnit[];
}

export interface StyleMdStyleguideResult {
  styleMdPath: string;
  promptInputPath: string;
  responseRawPath: string;
  validationPath: string;
  evidenceAgentPath: string;
  workspaceDir: string;
  styleMarkdown: string;
  typographyInventoryPath: string;
  typographyInventory: Array<{
    family: string;
    usage_count: number;
  }>;
  requiredTypographyFamilies: string[];
  query: {
    maxTurns: number;
    timeoutMs: number;
    durationMs: number;
    failed: boolean;
    failureReason?: string;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}

export interface StyleMdShowcaseResult {
  promptInputPath: string;
  responseRawPath: string;
  validationPath: string;
  warning?: string;
  showcase: {
    available: boolean;
    canonicalUrl: string;
    latestUrl: string;
    htmlPath?: string;
    validationPath?: string;
    warning?: string;
  };
  query: {
    maxTurns: number;
    timeoutMs: number;
    durationMs: number;
    failed: boolean;
    failureReason?: string;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}

export interface StyleMdMetrics {
  candidateCount: number;
  extractedComponents: number;
  dedupedComponents: number;
  duplicatesDeleted: number;
  curatedUnits: number;
  curatedComponents: number;
  curationDeleted: number;
}

export interface StyleMdRunState {
  runId: string;
  provider: StyleMdProvider;
  model: string;
  url: string;
  status: StyleMdRunStatus;
  startedAt: string;
  completedAt?: string;
  error?: string;
  warnings: string[];
  stages: StyleMdStageState[];
  artifacts: StyleMdArtifactRecord[];
  metrics: StyleMdMetrics;
  showcase: {
    available: boolean;
    canonicalUrl: string;
    latestUrl: string;
    htmlPath?: string;
    validationPath?: string;
    warning?: string;
  };
}

export interface StyleMdRunSummary {
  runId: string;
  provider: StyleMdProvider;
  model: string;
  url: string;
  status: StyleMdRunStatus;
  startedAt: string;
  completedAt?: string;
  error?: string;
  warnings: string[];
  artifacts: StyleMdArtifactRecord[];
  metrics: StyleMdMetrics;
  showcase: {
    available: boolean;
    canonicalUrl: string;
    latestUrl: string;
    htmlPath?: string;
    validationPath?: string;
    warning?: string;
  };
}

export interface StyleMdPipelineConfig {
  viewport: {
    width: number;
    height: number;
    deviceScaleFactor: number;
  };
  widthThreshold: number;
  minHeightPx: number;
  dedupSsimThreshold: number;
}

export const DEFAULT_STYLEMD_PIPELINE_CONFIG: StyleMdPipelineConfig = {
  viewport: {
    width: 1366,
    height: 900,
    deviceScaleFactor: 1,
  },
  widthThreshold: 0.95,
  minHeightPx: 10,
  dedupSsimThreshold: 1,
};
