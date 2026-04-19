export type EventSource = "agent" | "user" | "system";

export type StyleMdStageName = "capture" | "extract" | "dedup" | "curate" | "styleguide" | "showcase";
export type StyleMdProvider = "claude" | "kimi";

export type StyleMdRunStatus =
  | "idle"
  | "running"
  | "completed"
  | "completed_with_warnings"
  | "failed"
  | "canceled";

export type StyleMdStageRuntimeStatus = "pending" | "running" | "completed" | "failed";

export type StyleMdStageState = {
  stage: StyleMdStageName;
  status: StyleMdStageRuntimeStatus;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  error?: string;
};

export type StyleMdArtifactRecord = {
  name: string;
  path: string;
  kind: "json" | "image" | "html" | "css" | "text" | "binary";
  sizeBytes?: number;
};

export type StyleMdMetrics = {
  candidateCount: number;
  extractedComponents: number;
  dedupedComponents: number;
  duplicatesDeleted: number;
  curatedUnits: number;
  curatedComponents: number;
  curationDeleted: number;
};

export type StyleMdUiState = {
  activeRunId: string | null;
  lastRunId: string | null;
  provider: StyleMdProvider;
  model: string | null;
  status: StyleMdRunStatus;
  url: string | null;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  warnings: string[];
  stages: StyleMdStageState[];
  artifacts: StyleMdArtifactRecord[];
  metrics: StyleMdMetrics;
  showcaseAvailable: boolean;
  showcaseUrl: string | null;
  showcaseLatestUrl: string | null;
};

type BaseEvent = {
  id: string;
  timestamp: string;
};

export type AssistantMessageDeltaEvent = BaseEvent & {
  type: "assistant_message_delta";
  source: "agent";
  delta: string;
};

export type AssistantFinalMessageEvent = BaseEvent & {
  type: "assistant_final_message";
  source: "agent";
  text: string;
  raw?: unknown;
};

export type ToolStartedEvent = BaseEvent & {
  type: "tool_started";
  source: EventSource;
  toolName: string;
  toolUseId?: string;
  inputSummary: string;
  rawInput?: unknown;
};

export type ToolFinishedEvent = BaseEvent & {
  type: "tool_finished";
  source: EventSource;
  toolName: string;
  toolUseId?: string;
  outputSummary: string;
  rawOutput?: unknown;
};

export type ToolFailedEvent = BaseEvent & {
  type: "tool_failed";
  source: EventSource;
  toolName: string;
  toolUseId?: string;
  error: string;
  rawError?: unknown;
};

export type StyleMdRunStartedEvent = BaseEvent & {
  type: "stylemd_run_started";
  source: "system";
  runId: string;
  url: string;
  provider?: StyleMdProvider;
  model?: string;
  startedAt: string;
  stages: StyleMdStageName[];
};

export type StyleMdStageStartedEvent = BaseEvent & {
  type: "stylemd_stage_started";
  source: "system";
  runId: string;
  stage: StyleMdStageName;
  startedAt: string;
};

export type StyleMdStageCompletedEvent = BaseEvent & {
  type: "stylemd_stage_completed";
  source: "system";
  runId: string;
  stage: StyleMdStageName;
  durationMs: number;
};

export type StyleMdStageFailedEvent = BaseEvent & {
  type: "stylemd_stage_failed";
  source: "system";
  runId: string;
  stage: StyleMdStageName;
  error: string;
};

export type StyleMdArtifactReadyEvent = BaseEvent & {
  type: "stylemd_artifact_ready";
  source: "system";
  runId: string;
  artifact: StyleMdArtifactRecord;
};

export type StyleMdActionEvent = BaseEvent & {
  type: "stylemd_action";
  source: "system";
  runId: string;
  stage?: StyleMdStageName;
  level: "info" | "warn" | "error";
  message: string;
  detail?: unknown;
};

export type StyleMdRunCompletedEvent = BaseEvent & {
  type: "stylemd_run_completed";
  source: "system";
  runId: string;
  provider?: StyleMdProvider;
  model?: string;
  status: Exclude<StyleMdRunStatus, "idle" | "running">;
  completedAt?: string;
  error?: string;
  warnings?: string[];
  showcase?: {
    available: boolean;
    canonicalUrl: string;
    latestUrl: string;
  };
};

export type SessionResetEvent = BaseEvent & {
  type: "session_reset";
  source: "system";
  reason: string;
};

export type PlaygroundEvent =
  | AssistantMessageDeltaEvent
  | AssistantFinalMessageEvent
  | ToolStartedEvent
  | ToolFinishedEvent
  | ToolFailedEvent
  | StyleMdRunStartedEvent
  | StyleMdStageStartedEvent
  | StyleMdStageCompletedEvent
  | StyleMdStageFailedEvent
  | StyleMdArtifactReadyEvent
  | StyleMdActionEvent
  | StyleMdRunCompletedEvent
  | SessionResetEvent;

export type PlaygroundState = {
  events: PlaygroundEvent[];
  stylemd: StyleMdUiState;
};

export type EventEnvelope =
  | {
      type: "state_sync";
      payload: PlaygroundState;
    }
  | {
      type: "event";
      payload: PlaygroundEvent;
    };
