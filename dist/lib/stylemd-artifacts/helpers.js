"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StyleMdPipelineAbortedError = void 0;
exports.nowIso = nowIso;
exports.makeRunId = makeRunId;
exports.createInitialStages = createInitialStages;
exports.createInitialRunState = createInitialRunState;
exports.mergeArtifact = mergeArtifact;
exports.updateRunState = updateRunState;
exports.updateStageState = updateStageState;
exports.assertNotAborted = assertNotAborted;
exports.errorToMessage = errorToMessage;
exports.isAbortError = isAbortError;
const types_1 = require("@/lib/stylemd-artifacts/types");
class StyleMdPipelineAbortedError extends Error {
    constructor(message = "Style artifact pipeline canceled") {
        super(message);
        this.name = "StyleMdPipelineAbortedError";
    }
}
exports.StyleMdPipelineAbortedError = StyleMdPipelineAbortedError;
function nowIso() {
    return new Date().toISOString();
}
function makeRunId() {
    return `stylemd_${Date.now()}`;
}
function createInitialStages() {
    return types_1.STYLEMD_PIPELINE_STAGES.map((stage) => ({
        stage,
        status: "pending",
    }));
}
function createInitialRunState(runId, url, provider, model) {
    const startedAt = nowIso();
    return {
        runId,
        provider,
        model,
        url,
        status: "running",
        startedAt,
        warnings: [],
        stages: createInitialStages(),
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
        showcase: {
            available: false,
            canonicalUrl: `/styleguide/${runId}`,
            latestUrl: "/styleguide",
        },
    };
}
function mergeArtifact(artifacts, artifact) {
    const withoutExisting = artifacts.filter((item) => item.path !== artifact.path);
    withoutExisting.push(artifact);
    return withoutExisting;
}
function updateRunState(state, patch) {
    return {
        ...state,
        ...patch,
    };
}
function updateStageState(state, stage, patch) {
    return {
        ...state,
        stages: state.stages.map((item) => {
            if (item.stage !== stage) {
                return item;
            }
            return {
                ...item,
                ...patch,
            };
        }),
    };
}
function assertNotAborted(signal) {
    if (signal.aborted) {
        throw new StyleMdPipelineAbortedError();
    }
}
function errorToMessage(error) {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}
function isAbortError(error) {
    if (error instanceof StyleMdPipelineAbortedError) {
        return true;
    }
    if (error instanceof Error) {
        const name = error.name.toLowerCase();
        const message = error.message.toLowerCase();
        return name.includes("abort") || message.includes("abort") || message.includes("cancel");
    }
    return false;
}
