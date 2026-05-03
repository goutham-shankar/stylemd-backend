"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const node_test_1 = __importDefault(require("node:test"));
const artifacts_1 = require("@/lib/stylemd-artifacts/artifacts");
const runManager_1 = require("@/lib/stylemd-artifacts/runManager");
function makeRunId() {
    return `stylemd_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
(0, node_test_1.default)("getStyleMdRunSummary backfills provider/model for legacy summaries", async () => {
    const runId = makeRunId();
    const runDir = (0, artifacts_1.getStyleMdRunDir)(runId);
    await (0, promises_1.mkdir)(runDir, { recursive: true });
    const legacySummary = {
        runId,
        url: "https://example.com",
        status: "completed",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        warnings: [],
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
    await (0, promises_1.writeFile)((0, node_path_1.join)(runDir, "summary.json"), JSON.stringify(legacySummary, null, 2));
    const summary = await (0, runManager_1.getStyleMdRunSummary)(runId);
    strict_1.default.ok(summary);
    strict_1.default.equal(summary?.provider, "claude");
    strict_1.default.equal(typeof summary?.model, "string");
    strict_1.default.ok((summary?.model?.length ?? 0) > 0);
    await (0, promises_1.rm)(runDir, { recursive: true, force: true });
});
