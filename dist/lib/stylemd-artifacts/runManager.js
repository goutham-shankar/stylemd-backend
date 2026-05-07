"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getActiveStyleMdRunId = getActiveStyleMdRunId;
exports.startStyleMdRun = startStyleMdRun;
exports.cancelActiveStyleMdRun = cancelActiveStyleMdRun;
exports.getStyleMdRunSummary = getStyleMdRunSummary;
exports.listStyleMdRunSummaries = listStyleMdRunSummaries;
exports.getLatestStyleMdShowcaseRunSummary = getLatestStyleMdShowcaseRunSummary;
const artifacts_1 = require("../../lib/stylemd-artifacts/artifacts");
const helpers_1 = require("../../lib/stylemd-artifacts/helpers");
const provider_1 = require("../../lib/stylemd-artifacts/provider");
const runStyleMdArtifactsPipeline_1 = require("../../lib/stylemd-artifacts/runStyleMdArtifactsPipeline");
const GLOBAL_KEY = "__stylemd_artifact_pipeline_manager__";
function withShowcaseDefaults(summary) {
    const showcase = (summary.showcase ?? {});
    return {
        ...summary,
        provider: summary.provider ?? "claude",
        model: summary.model ?? (0, provider_1.resolveDefaultClaudeModel)(),
        showcase: {
            available: showcase.available ?? false,
            canonicalUrl: showcase.canonicalUrl ?? `/styleguide/${summary.runId}`,
            latestUrl: showcase.latestUrl ?? "/styleguide",
            htmlPath: showcase.htmlPath,
            validationPath: showcase.validationPath,
            warning: showcase.warning,
        },
    };
}
function toSummary(state) {
    return withShowcaseDefaults({
        runId: state.runId,
        provider: state.provider,
        model: state.model,
        url: state.url,
        status: state.status,
        startedAt: state.startedAt,
        completedAt: state.completedAt,
        error: state.error,
        warnings: state.warnings,
        artifacts: state.artifacts,
        metrics: state.metrics,
        showcase: state.showcase,
    });
}
function getGlobalState() {
    const globalObject = globalThis;
    if (!globalObject[GLOBAL_KEY]) {
        globalObject[GLOBAL_KEY] = {
            active: null,
            summaries: new Map(),
        };
    }
    return globalObject[GLOBAL_KEY];
}
function getActiveStyleMdRunId() {
    return getGlobalState().active?.runId ?? null;
}
async function startStyleMdRun(url, provider = "claude") {
    const state = getGlobalState();
    if (state.active) {
        throw new Error(`A style artifact run is already active: ${state.active.runId}`);
    }
    const runId = (0, helpers_1.makeRunId)();
    const abortController = new AbortController();
    const promise = (0, runStyleMdArtifactsPipeline_1.runStyleMdArtifactsPipeline)(runId, url, abortController, {
        provider,
        onStateChange: (nextState) => {
            const current = getGlobalState();
            current.summaries.set(runId, toSummary(nextState));
        },
    })
        .then((summary) => {
        const current = getGlobalState();
        current.summaries.set(runId, summary);
        if (current.active?.runId === runId) {
            current.active = null;
        }
        return summary;
    })
        .catch((error) => {
        const current = getGlobalState();
        if (current.active?.runId === runId) {
            current.active = null;
        }
        throw error;
    });
    state.active = {
        runId,
        abortController,
        promise,
    };
    return { runId };
}
async function cancelActiveStyleMdRun() {
    const state = getGlobalState();
    if (!state.active) {
        return {
            canceled: false,
            runId: null,
        };
    }
    const runId = state.active.runId;
    state.active.abortController.abort();
    return {
        canceled: true,
        runId,
    };
}
async function getStyleMdRunSummary(runId) {
    const state = getGlobalState();
    const inMemory = state.summaries.get(runId);
    if (inMemory) {
        return withShowcaseDefaults(inMemory);
    }
    const fromDiskSummary = await (0, artifacts_1.readStyleMdSummary)(runId);
    if (fromDiskSummary) {
        const normalized = withShowcaseDefaults(fromDiskSummary);
        state.summaries.set(runId, normalized);
        return normalized;
    }
    const fromDiskState = await (0, artifacts_1.readStyleMdState)(runId);
    if (fromDiskState) {
        const summary = toSummary(fromDiskState);
        state.summaries.set(runId, summary);
        return summary;
    }
    return null;
}
async function listStyleMdRunSummaries() {
    const state = getGlobalState();
    const runIds = new Set([
        ...state.summaries.keys(),
        ...(await (0, artifacts_1.listStyleMdRunIdsFromDisk)()),
    ]);
    const results = [];
    for (const runId of runIds) {
        const summary = await getStyleMdRunSummary(runId);
        if (summary) {
            results.push(summary);
        }
    }
    results.sort((a, b) => {
        const aTime = Date.parse(a.completedAt ?? a.startedAt);
        const bTime = Date.parse(b.completedAt ?? b.startedAt);
        return bTime - aTime;
    });
    return results;
}
async function getLatestStyleMdShowcaseRunSummary() {
    const summaries = await listStyleMdRunSummaries();
    return summaries.find((summary) => summary.showcase.available) ?? null;
}
