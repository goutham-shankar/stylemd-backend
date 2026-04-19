"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  EventEnvelope,
  PlaygroundEvent,
  StyleMdArtifactRecord,
  StyleMdProvider,
  StyleMdStageState,
  StyleMdUiState,
} from "@/lib/types/stylemdEvents";
import styles from "./stylemd.module.css";

const DEFAULT_STYLEMD_STATE: StyleMdUiState = {
  activeRunId: null,
  lastRunId: null,
  provider: "kimi",
  model: "kimi-k2-thinking",
  status: "idle",
  url: null,
  startedAt: null,
  completedAt: null,
  error: null,
  warnings: [],
  stages: [],
  artifacts: [],
  metrics: {
    candidateCount: 0,
    extractedComponents: 0,
    dedupedComponents: 0,
    duplicatesDeleted: 0,
    curatedUnits: 0,
    curatedComponents: 0,
    curationDeleted: 0,
  },
  showcaseAvailable: false,
  showcaseUrl: null,
  showcaseLatestUrl: null,
};

type ArtifactPreview =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "text"; content: string; truncated: boolean }
  | { state: "image"; rawUrl: string }
  | { state: "unsupported"; message: string };

type TimelineTone = "neutral" | "good" | "warn" | "bad" | "agent" | "tool";

type TimelineEntry = {
  id: string;
  timestamp: string;
  tone: TimelineTone;
  label: string;
  title: string;
  message?: string;
  stage?: string;
  event: PlaygroundEvent;
};

const STYLEMD_TAG_PREFIX = "[stylemd:";
const STYLEMD_TAG_REGEX = /^\[stylemd:([^:]+):([^\]]+)\](?:\u2063|\n)?/;

function formatTime(iso?: string): string {
  if (!iso) {
    return "—";
  }
  try {
    return new Date(iso).toLocaleTimeString();
  } catch {
    return iso;
  }
}

function formatDuration(ms?: number): string {
  if (!ms && ms !== 0) {
    return "—";
  }
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(2)}s`;
}

function artifactLabel(artifact: StyleMdArtifactRecord): string {
  if (!artifact.sizeBytes && artifact.sizeBytes !== 0) {
    return artifact.kind;
  }
  return `${artifact.kind} • ${artifact.sizeBytes} bytes`;
}

function parseStyleMdTag(text: string): { runId: string; stage: string } | null {
  const match = text.match(STYLEMD_TAG_REGEX);
  if (!match) {
    return null;
  }
  return {
    runId: match[1],
    stage: match[2],
  };
}

function stripStyleMdTag(text: string): string {
  return text.replace(STYLEMD_TAG_REGEX, "");
}

function stageStatusClass(stage: StyleMdStageState): string {
  if (stage.status === "running") return styles.running;
  if (stage.status === "completed") return styles.completed;
  if (stage.status === "failed") return styles.failed;
  return styles.pending;
}

function normalizeStyleMdState(state: Partial<StyleMdUiState>): StyleMdUiState {
  const provider = state.provider === "kimi" ? "kimi" : "claude";
  return {
    ...DEFAULT_STYLEMD_STATE,
    ...state,
    provider,
    model: state.model ?? (provider === "kimi" ? "kimi-k2.5" : null),
    metrics: {
      ...DEFAULT_STYLEMD_STATE.metrics,
      ...(state.metrics ?? {}),
    },
  };
}

function applyStyleMdEvent(previous: StyleMdUiState, event: PlaygroundEvent): StyleMdUiState {
  if (event.type === "session_reset") {
    return {
      ...DEFAULT_STYLEMD_STATE,
      provider: previous.provider,
      model: previous.model,
      url: previous.url,
    };
  }

  if (event.type === "stylemd_run_started") {
    const provider = event.provider ?? previous.provider ?? "claude";
    const model = event.model ?? (provider === "kimi" ? "kimi-k2.5" : previous.model ?? "default");
    return {
      activeRunId: event.runId,
      lastRunId: event.runId,
      provider,
      model,
      status: "running",
      url: event.url,
      startedAt: event.startedAt,
      completedAt: null,
      error: null,
      warnings: [],
      stages: event.stages.map((stage) => ({ stage, status: "pending" })),
      artifacts: [],
      metrics: {
        candidateCount: 0,
        extractedComponents: 0,
        dedupedComponents: 0,
        duplicatesDeleted: 0,
        curatedUnits: 0,
        curatedComponents: 0,
        curationDeleted: 0,
      },
      showcaseAvailable: false,
      showcaseUrl: `/styleguide/${event.runId}`,
      showcaseLatestUrl: "/styleguide",
    };
  }

  if (event.type === "stylemd_stage_started") {
    return {
      ...previous,
      stages: previous.stages.map((stage) =>
        stage.stage === event.stage
          ? {
              ...stage,
              status: "running",
              startedAt: event.startedAt,
              completedAt: undefined,
              durationMs: undefined,
              error: undefined,
            }
          : stage,
      ),
    };
  }

  if (event.type === "stylemd_stage_completed") {
    return {
      ...previous,
      stages: previous.stages.map((stage) =>
        stage.stage === event.stage
          ? {
              ...stage,
              status: "completed",
              completedAt: event.timestamp,
              durationMs: event.durationMs,
              error: undefined,
            }
          : stage,
      ),
    };
  }

  if (event.type === "stylemd_stage_failed") {
    return {
      ...previous,
      stages: previous.stages.map((stage) =>
        stage.stage === event.stage
          ? {
              ...stage,
              status: "failed",
              completedAt: event.timestamp,
              error: event.error,
            }
          : stage,
      ),
      error: event.error,
    };
  }

  if (event.type === "stylemd_artifact_ready") {
    return {
      ...previous,
      artifacts: [event.artifact, ...previous.artifacts.filter((item) => item.path !== event.artifact.path)],
    };
  }

  if (event.type === "stylemd_action") {
    if (event.level === "warn") {
      return {
        ...previous,
        warnings: [event.message, ...previous.warnings].slice(0, 40),
      };
    }
    if (event.level === "error") {
      return {
        ...previous,
        error: event.message,
      };
    }
  }

  if (event.type === "stylemd_run_completed") {
    return {
      ...previous,
      activeRunId: null,
      lastRunId: event.runId,
      provider: event.provider ?? previous.provider,
      model: event.model ?? previous.model,
      status: event.status,
      completedAt: event.completedAt ?? event.timestamp,
      error: event.error ?? null,
      warnings: event.warnings ?? previous.warnings,
      showcaseAvailable: event.showcase?.available ?? previous.showcaseAvailable,
      showcaseUrl: event.showcase?.canonicalUrl ?? previous.showcaseUrl,
      showcaseLatestUrl: event.showcase?.latestUrl ?? previous.showcaseLatestUrl,
    };
  }

  return previous;
}

function isStyleMdTimelineEvent(
  event: PlaygroundEvent,
  runId: string | null,
  styleMdDeltaIds: Set<string>,
): boolean {
  if (!runId) {
    return false;
  }

  if (
    event.type === "stylemd_run_started" ||
    event.type === "stylemd_stage_started" ||
    event.type === "stylemd_stage_completed" ||
    event.type === "stylemd_stage_failed" ||
    event.type === "stylemd_artifact_ready" ||
    event.type === "stylemd_action" ||
    event.type === "stylemd_run_completed"
  ) {
    return event.runId === runId;
  }

  if (event.type === "tool_started" || event.type === "tool_finished" || event.type === "tool_failed") {
    return event.toolName.includes(`[stylemd:${runId}:`);
  }

  if (event.type === "assistant_final_message") {
    const parsed = parseStyleMdTag(event.text);
    return parsed?.runId === runId;
  }

  if (event.type === "assistant_message_delta") {
    return styleMdDeltaIds.has(event.id);
  }

  return false;
}

function cleanToolName(toolName: string): string {
  return toolName.replace(/^\[stylemd:[^\]]+\]\s*/, "");
}

function eventToTimelineEntry(event: PlaygroundEvent): TimelineEntry {
  if (event.type === "stylemd_run_started") {
    return {
      id: event.id,
      timestamp: event.timestamp,
      tone: "good",
      label: "run",
      title: `Run started for ${event.url}`,
      message: `Stages: ${event.stages.join(" -> ")}`,
      event,
    };
  }

  if (event.type === "stylemd_run_completed") {
    return {
      id: event.id,
      timestamp: event.timestamp,
      tone: event.status === "completed" ? "good" : event.status === "completed_with_warnings" ? "warn" : "bad",
      label: "run",
      title: `Run completed with status: ${event.status}`,
      message: event.error ?? (event.warnings && event.warnings.length > 0 ? event.warnings[0] : undefined),
      event,
    };
  }

  if (event.type === "stylemd_stage_started") {
    return {
      id: event.id,
      timestamp: event.timestamp,
      tone: "neutral",
      label: "stage",
      title: `${event.stage} started`,
      stage: event.stage,
      event,
    };
  }

  if (event.type === "stylemd_stage_completed") {
    return {
      id: event.id,
      timestamp: event.timestamp,
      tone: "good",
      label: "stage",
      title: `${event.stage} completed`,
      message: `Duration: ${formatDuration(event.durationMs)}`,
      stage: event.stage,
      event,
    };
  }

  if (event.type === "stylemd_stage_failed") {
    return {
      id: event.id,
      timestamp: event.timestamp,
      tone: "bad",
      label: "stage",
      title: `${event.stage} failed`,
      message: event.error,
      stage: event.stage,
      event,
    };
  }

  if (event.type === "stylemd_artifact_ready") {
    return {
      id: event.id,
      timestamp: event.timestamp,
      tone: "neutral",
      label: "artifact",
      title: `Artifact ready: ${event.artifact.name}`,
      message: artifactLabel(event.artifact),
      event,
    };
  }

  if (event.type === "stylemd_action") {
    return {
      id: event.id,
      timestamp: event.timestamp,
      tone: event.level === "error" ? "bad" : event.level === "warn" ? "warn" : "neutral",
      label: "action",
      title: event.message,
      stage: event.stage,
      event,
    };
  }

  if (event.type === "tool_started") {
    return {
      id: event.id,
      timestamp: event.timestamp,
      tone: "tool",
      label: "tool",
      title: `Tool started: ${cleanToolName(event.toolName)}`,
      message: event.inputSummary,
      event,
    };
  }

  if (event.type === "tool_finished") {
    return {
      id: event.id,
      timestamp: event.timestamp,
      tone: "tool",
      label: "tool",
      title: `Tool finished: ${cleanToolName(event.toolName)}`,
      message: event.outputSummary,
      event,
    };
  }

  if (event.type === "tool_failed") {
    return {
      id: event.id,
      timestamp: event.timestamp,
      tone: "bad",
      label: "tool",
      title: `Tool failed: ${cleanToolName(event.toolName)}`,
      message: event.error,
      event,
    };
  }

  if (event.type === "assistant_message_delta") {
    return {
      id: event.id,
      timestamp: event.timestamp,
      tone: "agent",
      label: "assistant",
      title: "Streaming text chunk",
      message: stripStyleMdTag(event.delta),
      event,
    };
  }

  if (event.type === "assistant_final_message") {
    const tag = parseStyleMdTag(event.text);
    return {
      id: event.id,
      timestamp: event.timestamp,
      tone: "agent",
      label: "assistant",
      title: tag ? `Assistant message (${tag.stage})` : "Assistant message",
      message: stripStyleMdTag(event.text),
      stage: tag?.stage,
      event,
    };
  }

  return {
    id: event.id,
    timestamp: event.timestamp,
    tone: "neutral",
    label: event.type,
    title: event.type,
    event,
  };
}

async function copyEventPayload(event: PlaygroundEvent): Promise<void> {
  if (!navigator?.clipboard) {
    return;
  }
  await navigator.clipboard.writeText(JSON.stringify(event, null, 2));
}

export default function StyleMdPage() {
  const [url, setUrl] = useState("https://example.com");
  const [selectedProvider] = useState<StyleMdProvider>("kimi");
  const [busy, setBusy] = useState(false);
  const [stylemd, setStyleMd] = useState<StyleMdUiState>(DEFAULT_STYLEMD_STATE);
  const [events, setEvents] = useState<PlaygroundEvent[]>([]);
  const [styleMdDeltaIds, setStyleMdDeltaIds] = useState<string[]>([]);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [selectedArtifactPath, setSelectedArtifactPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<ArtifactPreview>({ state: "idle" });
  const [expandedEventIds, setExpandedEventIds] = useState<string[]>([]);
  const [copiedEventId, setCopiedEventId] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<{ [key: string]: boolean }>({
    artifacts: true,
    timeline: true,
    metrics: false,
  });

  const stylemdRef = useRef<StyleMdUiState>(DEFAULT_STYLEMD_STATE);
  const streamingRunRef = useRef<string | null>(null);

  const runId = stylemd.activeRunId ?? stylemd.lastRunId;
  const displayedProvider = runId ? stylemd.provider : selectedProvider;
  const displayedModel = runId
    ? stylemd.model
    : (selectedProvider === "kimi" ? "kimi-k2.5" : (stylemd.model ?? "default"));
  const selectedArtifact = useMemo(
    () => stylemd.artifacts.find((artifact) => artifact.path === selectedArtifactPath) ?? null,
    [stylemd.artifacts, selectedArtifactPath],
  );

  const styleMdDeltaIdSet = useMemo(() => new Set(styleMdDeltaIds), [styleMdDeltaIds]);

  const timelineEntries = useMemo(() => {
    return events
      .filter((event) => isStyleMdTimelineEvent(event, runId, styleMdDeltaIdSet))
      .map(eventToTimelineEntry);
  }, [events, runId, styleMdDeltaIdSet]);

  useEffect(() => {
    stylemdRef.current = stylemd;
  }, [stylemd]);

  useEffect(() => {
    const source = new EventSource("/api/session/events");
    source.onmessage = (evt) => {
      try {
        const envelope = JSON.parse(evt.data) as EventEnvelope;
        if (envelope.type === "state_sync") {
          const normalizedStyleMd = normalizeStyleMdState(envelope.payload.stylemd);
          setStyleMd(normalizedStyleMd);
          setEvents(envelope.payload.events);
          const seededDeltaIds = envelope.payload.events
            .filter(
              (event): event is Extract<PlaygroundEvent, { type: "assistant_message_delta" }> =>
                event.type === "assistant_message_delta" && event.delta.includes(STYLEMD_TAG_PREFIX),
            )
            .map((event) => event.id);
          setStyleMdDeltaIds(seededDeltaIds.slice(-5000));
          return;
        }

        const payload = envelope.payload;

        if (payload.type === "assistant_message_delta") {
          const currentStyleMd = stylemdRef.current;
          const activeRunId = currentStyleMd.activeRunId ?? currentStyleMd.lastRunId;
          const runMarker = activeRunId ? `[stylemd:${activeRunId}:` : null;

          const isStyleMdDelta =
            (runMarker !== null && payload.delta.includes(runMarker)) ||
            (activeRunId !== null &&
              currentStyleMd.status === "running" &&
              streamingRunRef.current === activeRunId) ||
            payload.delta.includes(STYLEMD_TAG_PREFIX);

          if (isStyleMdDelta) {
            if (activeRunId) {
              streamingRunRef.current = activeRunId;
            }
            setStyleMdDeltaIds((previous) => {
              if (previous.includes(payload.id)) {
                return previous;
              }
              return [...previous, payload.id].slice(-5000);
            });
          }
        }

        if (payload.type === "assistant_final_message") {
          const parsed = parseStyleMdTag(payload.text);
          if (parsed) {
            streamingRunRef.current = null;
          }
        }

        setEvents((previous) => [...previous, payload].slice(-4000));
        setStyleMd((previous) => applyStyleMdEvent(previous, payload));
      } catch (error) {
        console.error("Failed to parse SSE stylemd event", error);
      }
    };

    return () => source.close();
  }, []);

  useEffect(() => {
    if (stylemd.artifacts.length === 0) {
      setSelectedArtifactPath(null);
      return;
    }
    if (!selectedArtifactPath || !stylemd.artifacts.some((artifact) => artifact.path === selectedArtifactPath)) {
      setSelectedArtifactPath(stylemd.artifacts[0].path);
    }
  }, [selectedArtifactPath, stylemd.artifacts]);

  useEffect(() => {
    if (!runId || !selectedArtifact) {
      setPreview({ state: "idle" });
      return;
    }

    const controller = new AbortController();
    setPreview({ state: "loading" });

    void (async () => {
      try {
        const response = await fetch(
          `/api/stylemd-artifacts/artifact?runId=${encodeURIComponent(runId)}&path=${encodeURIComponent(selectedArtifact.path)}&mode=preview`,
          { signal: controller.signal },
        );
        const payload = (await response.json()) as
          | { ok: false; error?: string }
          | { ok: true; previewType: "text"; content: string; truncated: boolean }
          | { ok: true; previewType: "image"; rawUrl: string }
          | { ok: true; previewType: "unsupported"; message?: string };

        if (!response.ok || !("ok" in payload) || payload.ok !== true) {
          const message = "error" in payload && payload.error ? payload.error : "Failed to load artifact preview.";
          setPreview({ state: "error", message });
          return;
        }

        if (payload.previewType === "text") {
          setPreview({ state: "text", content: payload.content, truncated: payload.truncated });
          return;
        }
        if (payload.previewType === "image") {
          setPreview({ state: "image", rawUrl: payload.rawUrl });
          return;
        }
        setPreview({
          state: "unsupported",
          message: payload.message ?? "Preview unavailable for this file type.",
        });
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        setPreview({
          state: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    })();

    return () => controller.abort();
  }, [runId, selectedArtifact]);

  function toggleExpanded(id: string): void {
    setExpandedEventIds((previous) =>
      previous.includes(id)
        ? previous.filter((value) => value !== id)
        : [...previous, id].slice(-1000),
    );
  }

  function toggleSection(section: string): void {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  }

  async function onCopyEvent(entry: TimelineEntry): Promise<void> {
    await copyEventPayload(entry.event);
    setCopiedEventId(entry.id);
    setTimeout(() => {
      setCopiedEventId((current) => (current === entry.id ? null : current));
    }, 1500);
  }

  async function runStyleMd(): Promise<void> {
    setBusy(true);
    setRequestError(null);
    setStyleMd({
      ...DEFAULT_STYLEMD_STATE,
      provider: selectedProvider,
      model: selectedProvider === "kimi" ? "kimi-k2.5" : null,
      url,
    });
    setEvents([]);
    setStyleMdDeltaIds([]);
    setExpandedEventIds([]);
    setCopiedEventId(null);
    setSelectedArtifactPath(null);
    setPreview({ state: "idle" });
    streamingRunRef.current = null;
    try {
      const response = await fetch("/api/stylemd-artifacts/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, provider: selectedProvider }),
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) {
        setRequestError(payload.error ?? "Failed to start StyleMD run.");
      }
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function cancelStyleMd(): Promise<void> {
    setBusy(true);
    setRequestError(null);
    try {
      const response = await fetch("/api/stylemd-artifacts/cancel", { method: "POST" });
      const payload = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) {
        setRequestError(payload.error ?? "Failed to cancel StyleMD run.");
      }
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function resetStyleMd(): Promise<void> {
    setBusy(true);
    setRequestError(null);
    setStyleMd({
      ...DEFAULT_STYLEMD_STATE,
      provider: selectedProvider,
      model: selectedProvider === "kimi" ? "kimi-k2.5" : null,
      url,
    });
    setEvents([]);
    setStyleMdDeltaIds([]);
    setExpandedEventIds([]);
    setCopiedEventId(null);
    setSelectedArtifactPath(null);
    setPreview({ state: "idle" });
    streamingRunRef.current = null;
    try {
      const response = await fetch("/api/session/reset", { method: "POST" });
      const payload = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) {
        setRequestError(payload.error ?? "Failed to reset StyleMD state.");
      }
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.page}>
      {/* KIMI OPTIMIZED HEADER */}
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>🚀 KIMI StyleMD</p>
          <h1>AI-Powered Website Analysis</h1>
          <p>Extract, analyze, and curate website components with KIMI thinking.</p>
        </div>
        <div className={styles.headerLinks}>
          <Link href="/styleguide">View Latest</Link>
        </div>
      </header>

      {/* MAIN CONTROL PANEL */}
      <section className={styles.controlsCard}>
        <div className={styles.inputGroup}>
          <label htmlFor="stylemd-url">🔗 Website URL</label>
          <input
            id="stylemd-url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://example.com"
            disabled={busy || stylemd.status === "running"}
          />
        </div>

        <div className={styles.actionButtons}>
          <button 
            className={styles.primaryBtn}
            onClick={runStyleMd} 
            disabled={busy || stylemd.status === "running"}
          >
            {stylemd.status === "running" ? "⏳ Analyzing..." : "🎯 Analyze"}
          </button>
          <button
            className={styles.secondaryBtn}
            onClick={cancelStyleMd}
            disabled={busy || stylemd.status !== "running"}
          >
            ⏹ Cancel
          </button>
          <button 
            className={styles.secondaryBtn}
            onClick={resetStyleMd} 
            disabled={busy}
          >
            ↻ Reset
          </button>
        </div>

        {requestError && <p className={styles.errorLine}>❌ {requestError}</p>}
        
        {/* QUICK STATUS */}
        <div className={styles.quickStatus}>
          <div className={styles.statusItem}>
            <span>Status</span>
            <strong className={styles[`status_${stylemd.status}`]}>
              {stylemd.status === "running" ? "🔄 Running" : 
               stylemd.status === "completed" ? "✅ Done" :
               stylemd.status === "failed" ? "❌ Failed" :
               "⚪ Idle"}
            </strong>
          </div>
          <div className={styles.statusItem}>
            <span>Run ID</span>
            <code>{stylemd.activeRunId ?? stylemd.lastRunId ?? "—"}</code>
          </div>
          <div className={styles.statusItem}>
            <span>Model</span>
            <strong>KIMI k2-thinking</strong>
          </div>
          {stylemd.startedAt && (
            <div className={styles.statusItem}>
              <span>Duration</span>
              <strong>
                {stylemd.completedAt
                  ? formatDuration(new Date(stylemd.completedAt).getTime() - new Date(stylemd.startedAt).getTime())
                  : formatDuration(new Date().getTime() - new Date(stylemd.startedAt).getTime())}
              </strong>
            </div>
          )}
        </div>
      </section>

      {/* ARTIFACTS SECTION - PROMINENT */}
      <section className={styles.card}>
        <button
          className={styles.sectionToggle}
          onClick={() => setExpandedSections((prev) => ({ ...prev, artifacts: !prev.artifacts }))}
          type="button"
        >
          <span className={styles.toggleArrow}>{expandedSections.artifacts ? "▼" : "▶"}</span>
          <h2>📦 Generated Library</h2>
          <span className={styles.badgeSmall}>{stylemd.artifacts.length}</span>
        </button>
        
        {expandedSections.artifacts && (
          <div className={styles.artifactPanel}>
            <div className={styles.artifactList}>
              {stylemd.artifacts.length === 0 ? (
                <p className={styles.empty}>Run analysis to generate artifacts</p>
              ) : (
                stylemd.artifacts.map((artifact) => (
                  <button
                    key={artifact.path}
                    type="button"
                    className={`${styles.artifactButton} ${
                      selectedArtifactPath === artifact.path ? styles.artifactSelected : ""
                    }`}
                    onClick={() => setSelectedArtifactPath(artifact.path)}
                  >
                    <span className={styles.artifactName}>{artifact.name}</span>
                    <small className={styles.artifactMeta}>{artifactLabel(artifact)}</small>
                  </button>
                ))
              )}
            </div>
            <div className={styles.previewWrap}>
              {!selectedArtifact ? (
                <p className={styles.empty}>Select an artifact to preview</p>
              ) : (
                <>
                  <p className={styles.previewTitle}>{selectedArtifact.name}</p>
                  {preview.state === "loading" && <p className={styles.empty}>Loading…</p>}
                  {preview.state === "error" && <p className={styles.errorLine}>{preview.message}</p>}
                  {preview.state === "unsupported" && <p className={styles.empty}>{preview.message}</p>}
                  {preview.state === "text" && (
                    <>
                      {preview.truncated && <p className={styles.warnLine}>Preview truncated</p>}
                      <pre className={styles.preview}>{preview.content}</pre>
                    </>
                  )}
                  {preview.state === "image" && (
                    <img className={styles.previewImage} alt="preview" src={preview.rawUrl} />
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </section>

      {/* PIPELINE TIMELINE */}
      <section className={styles.card}>
        <button
          className={styles.sectionToggle}
          onClick={() => setExpandedSections((prev) => ({ ...prev, timeline: !prev.timeline }))}
          type="button"
        >
          <span className={styles.toggleArrow}>{expandedSections.timeline ? "▼" : "▶"}</span>
          <h2>📊 Pipeline Timeline</h2>
          <span className={styles.badgeSmall}>{timelineEntries.length}</span>
        </button>

        {expandedSections.timeline && (
          <>
            {/* STAGE PILLS */}
            {stylemd.stages.length > 0 && (
              <div className={styles.stageRibbon}>
                {stylemd.stages.map((stage) => (
                  <div key={stage.stage} className={`${styles.stagePill} ${stageStatusClass(stage)}`}>
                    <strong>{stage.stage}</strong>
                    <span className={styles.stageDot} />
                    <span>{stage.status}</span>
                    {stage.durationMs && <span className={styles.stageDuration}>{formatDuration(stage.durationMs)}</span>}
                  </div>
                ))}
              </div>
            )}

            {/* EVENTS LIST */}
            <div className={styles.timelineList}>
              {timelineEntries.length === 0 ? (
                <p className={styles.empty}>No events yet</p>
              ) : (
                timelineEntries.slice(0, 40).map((entry) => {
                  const expanded = expandedEventIds.includes(entry.id);
                  return (
                    <article
                      key={entry.id}
                      className={`${styles.timelineCard} ${styles[`tone_${entry.tone}`]}`}
                      onDoubleClick={() => toggleExpanded(entry.id)}
                    >
                      <div className={styles.cardHead}>
                        <div className={styles.eventLabel}>{entry.label}</div>
                        <time className={styles.eventTime}>{formatTime(entry.timestamp)}</time>
                      </div>
                      <h3>{entry.title}</h3>
                      {entry.message && <pre className={styles.message}>{entry.message}</pre>}
                      <div className={styles.cardActions}>
                        <button type="button" onClick={() => toggleExpanded(entry.id)}>
                          {expanded ? "Hide" : "Details"}
                        </button>
                        <button type="button" onClick={() => void onCopyEvent(entry)}>
                          {copiedEventId === entry.id ? "✓" : "Copy"}
                        </button>
                      </div>
                      {expanded && <pre className={styles.rawPayload}>{JSON.stringify(entry.event, null, 2)}</pre>}
                    </article>
                  );
                })
              )}
            </div>
          </>
        )}
      </section>

      {/* METRICS SECTION */}
      <section className={styles.card}>
        <button
          className={styles.sectionToggle}
          onClick={() => setExpandedSections((prev) => ({ ...prev, metrics: !prev.metrics }))}
          type="button"
        >
          <span className={styles.toggleArrow}>{expandedSections.metrics ? "▼" : "▶"}</span>
          <h2>📈 Pipeline Metrics</h2>
        </button>
        {expandedSections.metrics && (
          <div className={styles.metricsGrid}>
            <div>
              <span>Candidates</span>
              <strong>{stylemd.metrics.candidateCount}</strong>
            </div>
            <div>
              <span>Extracted</span>
              <strong>{stylemd.metrics.extractedComponents}</strong>
            </div>
            <div>
              <span>Deduped</span>
              <strong>{stylemd.metrics.dedupedComponents}</strong>
            </div>
            <div>
              <span>Deleted</span>
              <strong>{stylemd.metrics.duplicatesDeleted}</strong>
            </div>
            <div>
              <span>Curated</span>
              <strong>{stylemd.metrics.curatedUnits}</strong>
            </div>
            <div>
              <span>Components</span>
              <strong>{stylemd.metrics.curatedComponents}</strong>
            </div>
            {stylemd.showcaseAvailable && (
              <div>
                <span>Showcase</span>
                <strong>
                  <Link href={stylemd.showcaseUrl ?? "/styleguide"}>View →</Link>
                </strong>
              </div>
            )}
          </div>
        )}
      </section>

      {stylemd.error && (
        <section className={styles.errorCard}>
          <h3>Pipeline Error</h3>
          <pre>{stylemd.error}</pre>
        </section>
      )}
    </main>
  );
}
