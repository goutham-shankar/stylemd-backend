"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const node_test_1 = __importDefault(require("node:test"));
const artifacts_1 = require("../../../lib/stylemd-artifacts/artifacts");
const curation_1 = require("../../../lib/stylemd-artifacts/curation");
function makeRunId() {
    return `stylemd_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
async function fileExists(path) {
    try {
        await (0, promises_1.stat)(path);
        return true;
    }
    catch {
        return false;
    }
}
async function writeText(path, value) {
    await (0, promises_1.mkdir)((0, node_path_1.dirname)(path), { recursive: true });
    await (0, promises_1.writeFile)(path, value, "utf8");
}
async function createComponentFixture(runId, componentId, top) {
    const runDir = (0, artifacts_1.getStyleMdRunDir)(runId);
    const componentDir = (0, node_path_1.join)(runDir, "components", componentId);
    await (0, promises_1.mkdir)(componentDir, { recursive: true });
    const screenshotPath = (0, node_path_1.join)(componentDir, "screenshot.png");
    const metadataPath = (0, node_path_1.join)(componentDir, "metadata.json");
    const domPath = (0, node_path_1.join)(componentDir, "dom.html");
    const stylesPath = (0, node_path_1.join)(componentDir, "styles.json");
    const styleTreePath = (0, node_path_1.join)(componentDir, "style_tree.json");
    const pseudoStylesPath = (0, node_path_1.join)(componentDir, "pseudo_styles.json");
    const cssRuleRefsPath = (0, node_path_1.join)(componentDir, "css_rule_refs.json");
    const agentDomPath = (0, node_path_1.join)(componentDir, "dom.agent.html");
    const agentStylesPath = (0, node_path_1.join)(componentDir, "styles.agent.json");
    const agentStyleTreePath = (0, node_path_1.join)(componentDir, "style_tree.agent.json");
    const agentPseudoStylesPath = (0, node_path_1.join)(componentDir, "pseudo.agent.json");
    await writeText(screenshotPath, "png");
    await writeText(metadataPath, "{}");
    await writeText(domPath, "<div></div>");
    await writeText(stylesPath, "{}");
    await writeText(styleTreePath, "[]");
    await writeText(pseudoStylesPath, "{}");
    await writeText(cssRuleRefsPath, "[]");
    await writeText(agentDomPath, "<div></div>");
    await writeText(agentStylesPath, "{}");
    await writeText(agentStyleTreePath, "[]");
    await writeText(agentPseudoStylesPath, "{}");
    return {
        componentId,
        candidateId: `cand_${componentId}`,
        selector: `section.${componentId}`,
        tagName: "section",
        rect: {
            top,
            left: 0,
            width: 1200,
            height: 200,
            bottom: top + 200,
        },
        directory: componentDir,
        screenshotPath,
        metadataPath,
        domPath,
        stylesPath,
        styleTreePath,
        pseudoStylesPath,
        cssRuleRefsPath,
        agentDomPath,
        agentStylesPath,
        agentStyleTreePath,
        agentPseudoStylesPath,
    };
}
(0, node_test_1.default)("validateStyleMdCurationDecisions rejects unknown IDs", () => {
    const allowed = new Set(["a", "b"]);
    strict_1.default.throws(() => {
        (0, curation_1.validateStyleMdCurationDecisions)({
            units: [
                {
                    type: "single",
                    component_id: "z",
                    study_label: "Hero",
                    reason: "Primary visual anchor",
                },
            ],
        }, allowed);
    }, /Unknown component id/);
});
(0, node_test_1.default)("validateStyleMdCurationDecisions rejects duplicate assignment", () => {
    const allowed = new Set(["a", "b", "c"]);
    strict_1.default.throws(() => {
        (0, curation_1.validateStyleMdCurationDecisions)({
            units: [
                {
                    type: "single",
                    component_id: "a",
                    study_label: "Hero",
                    reason: "Primary",
                },
                {
                    type: "merge",
                    component_ids: ["a", "b"],
                    study_label: "Hero + CTA",
                    reason: "Joint composition",
                },
            ],
        }, allowed);
    }, /appears in multiple units/);
});
(0, node_test_1.default)("validateStyleMdCurationDecisions rejects invalid merge cardinality", () => {
    const allowed = new Set(["a", "b"]);
    strict_1.default.throws(() => {
        (0, curation_1.validateStyleMdCurationDecisions)({
            units: [
                {
                    type: "merge",
                    component_ids: ["a"],
                    study_label: "Merged",
                    reason: "Invalid",
                },
            ],
        }, allowed);
    });
});
(0, node_test_1.default)("validateStyleMdCurationDecisions rejects empty output", () => {
    const allowed = new Set(["a", "b"]);
    strict_1.default.throws(() => {
        (0, curation_1.validateStyleMdCurationDecisions)({
            units: [],
        }, allowed);
    });
});
(0, node_test_1.default)("applyStyleMdCurationDecisions computes keep/delete and only deletes non-curated directories", async () => {
    const runId = makeRunId();
    const runDir = (0, artifacts_1.getStyleMdRunDir)(runId);
    await (0, promises_1.mkdir)(runDir, { recursive: true });
    const c1 = await createComponentFixture(runId, "c1", 0);
    const c2 = await createComponentFixture(runId, "c2", 220);
    const c3 = await createComponentFixture(runId, "c3", 440);
    const deletedDirectories = [];
    const result = await (0, curation_1.applyStyleMdCurationDecisions)({
        runId,
        url: "https://example.com",
        sourceManifestPath: (0, node_path_1.join)(runDir, "components", "components_manifest.deduped.json"),
        decisions: [
            {
                type: "single",
                component_id: "c1",
                study_label: "Hero",
                reason: "Primary anchor",
            },
        ],
        components: [c1, c2, c3],
    }, {
        deleteDirectory: async (directory) => {
            deletedDirectories.push(directory);
        },
    });
    strict_1.default.deepEqual(result.keptComponentIds, ["c1"]);
    strict_1.default.deepEqual(result.deletedComponentIds, ["c2", "c3"]);
    strict_1.default.deepEqual(deletedDirectories.sort(), [c2.directory, c3.directory].sort());
    await (0, promises_1.rm)(runDir, { recursive: true, force: true });
});
(0, node_test_1.default)("runCurateStage integration (mocked Claude) writes curated manifest and deletes non-curated components", async () => {
    const runId = makeRunId();
    const runDir = (0, artifacts_1.getStyleMdRunDir)(runId);
    await (0, promises_1.mkdir)((0, node_path_1.join)(runDir, "components"), { recursive: true });
    await writeText((0, node_path_1.join)(runDir, "full_screenshot.png"), "png");
    const c1 = await createComponentFixture(runId, "c1", 0);
    const c2 = await createComponentFixture(runId, "c2", 220);
    const c3 = await createComponentFixture(runId, "c3", 440);
    const dedupAgentManifestPath = (0, node_path_1.join)(runDir, "components", "components_manifest.agent.json");
    await writeText(dedupAgentManifestPath, "{}");
    const output = await (0, curation_1.runCurateStage)({
        runId,
        url: "https://example.com",
        dedupAgentManifestPath,
        components: [c1, c2, c3],
        signal: new AbortController().signal,
        runClaudeQuery: async () => JSON.stringify({
            units: [
                {
                    type: "single",
                    component_id: "c1",
                    study_label: "Hero",
                    reason: "Main composition",
                },
                {
                    type: "single",
                    component_id: "c2",
                    study_label: "Feature strip",
                    reason: "Distinct visual pattern",
                },
            ],
        }),
    });
    strict_1.default.equal(output.result.curatedManifest.units.length, 2);
    strict_1.default.deepEqual(output.result.deletedComponentIds, ["c3"]);
    strict_1.default.equal(await fileExists(c3.directory), false);
    strict_1.default.equal(await fileExists(output.result.curatedManifestPath), true);
    strict_1.default.equal(await fileExists(output.result.promptInputPath), true);
    strict_1.default.equal(await fileExists(output.result.responseRawPath), true);
    strict_1.default.equal(await fileExists(output.result.decisionsParsedPath), true);
    strict_1.default.equal(await fileExists(output.result.decisionsAppliedPath), true);
    strict_1.default.equal(await fileExists((0, node_path_1.join)(runDir, "curation", "analysis.pass1.raw.txt")), false);
    strict_1.default.equal(await fileExists((0, node_path_1.join)(runDir, "curation", "decision.pass2.raw.txt")), false);
    await (0, promises_1.rm)(runDir, { recursive: true, force: true });
});
(0, node_test_1.default)("runCurateStage uses deterministic fallback on invalid Claude output and still completes", async () => {
    const runId = makeRunId();
    const runDir = (0, artifacts_1.getStyleMdRunDir)(runId);
    await (0, promises_1.mkdir)((0, node_path_1.join)(runDir, "components"), { recursive: true });
    await writeText((0, node_path_1.join)(runDir, "full_screenshot.png"), "png");
    const components = [];
    for (let i = 0; i < 8; i += 1) {
        components.push(await createComponentFixture(runId, `c${i + 1}`, i * 220));
    }
    const dedupAgentManifestPath = (0, node_path_1.join)(runDir, "components", "components_manifest.agent.json");
    await writeText(dedupAgentManifestPath, "{}");
    const output = await (0, curation_1.runCurateStage)({
        runId,
        url: "https://example.com",
        dedupAgentManifestPath,
        components,
        signal: new AbortController().signal,
        runClaudeQuery: async () => "not-json",
    });
    const parsedPayload = JSON.parse(await (0, promises_1.readFile)(output.result.decisionsParsedPath, "utf8"));
    strict_1.default.equal(parsedPayload.source, "deterministic_fallback");
    strict_1.default.equal(parsedPayload.ok, false);
    strict_1.default.ok(Array.isArray(parsedPayload.units));
    strict_1.default.ok(output.result.keptComponentIds.length > 0);
    strict_1.default.ok(output.result.keptComponentIds.length < components.length);
    strict_1.default.equal(await fileExists(output.result.curatedManifestPath), true);
    await (0, promises_1.rm)(runDir, { recursive: true, force: true });
});
(0, node_test_1.default)("runCurateStage forwards runtime provider/model/env to query runner", async () => {
    const runId = makeRunId();
    const runDir = (0, artifacts_1.getStyleMdRunDir)(runId);
    await (0, promises_1.mkdir)((0, node_path_1.join)(runDir, "components"), { recursive: true });
    await writeText((0, node_path_1.join)(runDir, "full_screenshot.png"), "png");
    const c1 = await createComponentFixture(runId, "c1", 0);
    const c2 = await createComponentFixture(runId, "c2", 220);
    const dedupAgentManifestPath = (0, node_path_1.join)(runDir, "components", "components_manifest.agent.json");
    await writeText(dedupAgentManifestPath, "{}");
    let capturedRuntime;
    await (0, curation_1.runCurateStage)({
        runId,
        url: "https://example.com",
        dedupAgentManifestPath,
        components: [c1, c2],
        signal: new AbortController().signal,
        runtime: {
            provider: "kimi",
            model: "kimi-k2.5",
            queryModel: "kimi-k2.5",
            env: {
                ANTHROPIC_BASE_URL: "https://api.moonshot.ai/anthropic",
                ANTHROPIC_AUTH_TOKEN: "sk-test",
            },
        },
        runClaudeQuery: async (queryInput) => {
            capturedRuntime = queryInput.runtime;
            return JSON.stringify({
                units: [
                    {
                        type: "single",
                        component_id: "c1",
                        study_label: "Hero",
                        reason: "Primary section",
                    },
                ],
            });
        },
    });
    strict_1.default.equal(capturedRuntime?.provider, "kimi");
    strict_1.default.equal(capturedRuntime?.model, "kimi-k2.5");
    strict_1.default.equal(capturedRuntime?.queryModel, "kimi-k2.5");
    strict_1.default.equal(capturedRuntime?.env.ANTHROPIC_BASE_URL, "https://api.moonshot.ai/anthropic");
    strict_1.default.equal(capturedRuntime?.env.ANTHROPIC_AUTH_TOKEN, "sk-test");
    await (0, promises_1.rm)(runDir, { recursive: true, force: true });
});
