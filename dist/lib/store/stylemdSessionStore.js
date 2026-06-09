"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPlaygroundState = getPlaygroundState;
exports.subscribeToEvents = subscribeToEvents;
exports.emitEvent = emitEvent;
exports.resetStyleMdSessionState = resetStyleMdSessionState;
exports.buildStateSyncEnvelope = buildStateSyncEnvelope;
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const GLOBAL_KEY = "__stylemd_lab_store__";
const STYLEMD_TAG_PREFIX = "[stylemd:";
function defaultStyleMdModel() {
    return process.env.CLAUDE_MODEL?.trim() || process.env.ANTHROPIC_MODEL?.trim() || "default";
}
function createDefaultStyleMdState() {
    return {
        activeRunId: null,
        lastRunId: null,
        provider: "claude",
        model: defaultStyleMdModel(),
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
}
function createDefaultState() {
    return {
        events: [],
        stylemd: createDefaultStyleMdState(),
    };
}
function initializeStyleMdStageStates(stages) {
    return stages.map((stage) => ({
        stage,
        status: "pending",
    }));
}
function getStore() {
    const globalObject = globalThis;
    if (!globalObject[GLOBAL_KEY]) {
        globalObject[GLOBAL_KEY] = {
            state: createDefaultState(),
            listeners: new Set(),
            nextEventCounter: 1,
        };
    }
    return globalObject[GLOBAL_KEY];
}
function newEventId(store) {
    const id = `evt_${store.nextEventCounter}`;
    store.nextEventCounter += 1;
    return id;
}
function nowIso() {
    return new Date().toISOString();
}
function isStyleMdScopedEvent(event) {
    if (event.type === "stylemd_run_started" ||
        event.type === "stylemd_stage_started" ||
        event.type === "stylemd_stage_completed" ||
        event.type === "stylemd_stage_failed" ||
        event.type === "stylemd_artifact_ready" ||
        event.type === "stylemd_action" ||
        event.type === "stylemd_run_completed") {
        return true;
    }
    if (event.type === "assistant_message_delta") {
        return event.delta.includes(STYLEMD_TAG_PREFIX);
    }
    if (event.type === "assistant_final_message") {
        return event.text.includes(STYLEMD_TAG_PREFIX);
    }
    if (event.type === "tool_started" || event.type === "tool_finished" || event.type === "tool_failed") {
        return event.toolName.includes(STYLEMD_TAG_PREFIX);
    }
    return false;
}
function broadcast(envelope) {
    const store = getStore();
    for (const listener of store.listeners) {
        listener(envelope);
    }
}
async function maybeWriteLatestRunFile() {
    if (process.env.PLAYGROUND_LOG_TO_FILE !== "true") {
        return;
    }
    const store = getStore();
    const outDir = (0, node_path_1.join)(process.cwd(), ".playground");
    await (0, promises_1.mkdir)(outDir, { recursive: true });
    const outPath = (0, node_path_1.join)(outDir, "latest-run.json");
    await (0, promises_1.writeFile)(outPath, JSON.stringify(store.state, null, 2), "utf8");
}
function safePersist() {
    void maybeWriteLatestRunFile().catch((error) => {
        console.error("[stylemdSessionStore] Failed to write latest-run.json", error);
    });
}
function getPlaygroundState() {
    return getStore().state;
}
function subscribeToEvents(listener) {
    const store = getStore();
    store.listeners.add(listener);
    return () => {
        store.listeners.delete(listener);
    };
}
function emitEvent(event) {
    const store = getStore();
    const fullEvent = {
        ...event,
        id: newEventId(store),
        timestamp: nowIso(),
    };
    if (fullEvent.type === "stylemd_run_started") {
        store.state.events = store.state.events.filter((existing) => !isStyleMdScopedEvent(existing));
    }
    store.state.events.push(fullEvent);
    if (store.state.events.length > 4000) {
        store.state.events.splice(0, store.state.events.length - 4000);
    }
    if (fullEvent.type === "stylemd_run_started") {
        store.state.stylemd = {
            activeRunId: fullEvent.runId,
            lastRunId: fullEvent.runId,
            provider: fullEvent.provider ?? "claude",
            model: fullEvent.model ?? defaultStyleMdModel(),
            status: "running",
            url: fullEvent.url,
            startedAt: fullEvent.startedAt,
            completedAt: null,
            error: null,
            warnings: [],
            stages: initializeStyleMdStageStates(fullEvent.stages),
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
            showcaseUrl: `/styleguide/${fullEvent.runId}`,
            showcaseLatestUrl: "/styleguide",
        };
    }
    if (fullEvent.type === "stylemd_stage_started") {
        store.state.stylemd.stages = store.state.stylemd.stages.map((stage) => stage.stage === fullEvent.stage
            ? {
                ...stage,
                status: "running",
                startedAt: fullEvent.startedAt,
                completedAt: undefined,
                durationMs: undefined,
                error: undefined,
            }
            : stage);
    }
    if (fullEvent.type === "stylemd_stage_completed") {
        store.state.stylemd.stages = store.state.stylemd.stages.map((stage) => stage.stage === fullEvent.stage
            ? {
                ...stage,
                status: "completed",
                completedAt: fullEvent.timestamp,
                durationMs: fullEvent.durationMs,
                error: undefined,
            }
            : stage);
    }
    if (fullEvent.type === "stylemd_stage_failed") {
        store.state.stylemd.stages = store.state.stylemd.stages.map((stage) => stage.stage === fullEvent.stage
            ? {
                ...stage,
                status: "failed",
                completedAt: fullEvent.timestamp,
                error: fullEvent.error,
            }
            : stage);
    }
    if (fullEvent.type === "stylemd_artifact_ready") {
        store.state.stylemd.artifacts = [
            fullEvent.artifact,
            ...store.state.stylemd.artifacts.filter((item) => item.path !== fullEvent.artifact.path),
        ];
    }
    if (fullEvent.type === "stylemd_action") {
        if (fullEvent.level === "error") {
            store.state.stylemd.error = fullEvent.message;
        }
        if (fullEvent.level === "warn") {
            store.state.stylemd.warnings = [fullEvent.message, ...store.state.stylemd.warnings].slice(0, 40);
        }
    }
    if (fullEvent.type === "stylemd_run_completed") {
        store.state.stylemd = {
            ...store.state.stylemd,
            activeRunId: null,
            lastRunId: fullEvent.runId,
            provider: fullEvent.provider ?? store.state.stylemd.provider,
            model: fullEvent.model ?? store.state.stylemd.model,
            status: fullEvent.status,
            completedAt: fullEvent.completedAt ?? fullEvent.timestamp,
            error: fullEvent.error ?? null,
            warnings: fullEvent.warnings ?? store.state.stylemd.warnings,
            showcaseAvailable: fullEvent.showcase?.available ?? store.state.stylemd.showcaseAvailable,
            showcaseUrl: fullEvent.showcase?.canonicalUrl ?? store.state.stylemd.showcaseUrl,
            showcaseLatestUrl: fullEvent.showcase?.latestUrl ?? store.state.stylemd.showcaseLatestUrl,
        };
    }
    if (fullEvent.type === "session_reset") {
        store.state.stylemd = createDefaultStyleMdState();
    }
    broadcast({
        type: "event",
        payload: fullEvent,
    });
    safePersist();
    return fullEvent;
}
function resetStyleMdSessionState(reason = "Session reset") {
    const store = getStore();
    store.state = createDefaultState();
    emitEvent({
        type: "session_reset",
        source: "system",
        reason,
    });
}
function buildStateSyncEnvelope() {
    return {
        type: "state_sync",
        payload: getPlaygroundState(),
    };
}
