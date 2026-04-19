import assert from "node:assert/strict";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { getStyleMdRunDir } from "@/lib/stylemd-artifacts/artifacts";
import {
  applyStyleMdCurationDecisions,
  runCurateStage,
  validateStyleMdCurationDecisions,
} from "@/lib/stylemd-artifacts/curation";
import type { StyleMdComponentEntry } from "@/lib/stylemd-artifacts/types";

function makeRunId(): string {
  return `stylemd_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function writeText(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value, "utf8");
}

async function createComponentFixture(runId: string, componentId: string, top: number): Promise<StyleMdComponentEntry> {
  const runDir = getStyleMdRunDir(runId);
  const componentDir = join(runDir, "components", componentId);
  await mkdir(componentDir, { recursive: true });

  const screenshotPath = join(componentDir, "screenshot.png");
  const metadataPath = join(componentDir, "metadata.json");
  const domPath = join(componentDir, "dom.html");
  const stylesPath = join(componentDir, "styles.json");
  const styleTreePath = join(componentDir, "style_tree.json");
  const pseudoStylesPath = join(componentDir, "pseudo_styles.json");
  const cssRuleRefsPath = join(componentDir, "css_rule_refs.json");
  const agentDomPath = join(componentDir, "dom.agent.html");
  const agentStylesPath = join(componentDir, "styles.agent.json");
  const agentStyleTreePath = join(componentDir, "style_tree.agent.json");
  const agentPseudoStylesPath = join(componentDir, "pseudo.agent.json");

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

test("validateStyleMdCurationDecisions rejects unknown IDs", () => {
  const allowed = new Set(["a", "b"]);

  assert.throws(() => {
    validateStyleMdCurationDecisions(
      {
        units: [
          {
            type: "single",
            component_id: "z",
            study_label: "Hero",
            reason: "Primary visual anchor",
          },
        ],
      },
      allowed,
    );
  }, /Unknown component id/);
});

test("validateStyleMdCurationDecisions rejects duplicate assignment", () => {
  const allowed = new Set(["a", "b", "c"]);

  assert.throws(() => {
    validateStyleMdCurationDecisions(
      {
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
      },
      allowed,
    );
  }, /appears in multiple units/);
});

test("validateStyleMdCurationDecisions rejects invalid merge cardinality", () => {
  const allowed = new Set(["a", "b"]);

  assert.throws(() => {
    validateStyleMdCurationDecisions(
      {
        units: [
          {
            type: "merge",
            component_ids: ["a"],
            study_label: "Merged",
            reason: "Invalid",
          },
        ],
      },
      allowed,
    );
  });
});

test("validateStyleMdCurationDecisions rejects empty output", () => {
  const allowed = new Set(["a", "b"]);

  assert.throws(() => {
    validateStyleMdCurationDecisions(
      {
        units: [],
      },
      allowed,
    );
  });
});

test("applyStyleMdCurationDecisions computes keep/delete and only deletes non-curated directories", async () => {
  const runId = makeRunId();
  const runDir = getStyleMdRunDir(runId);
  await mkdir(runDir, { recursive: true });

  const c1 = await createComponentFixture(runId, "c1", 0);
  const c2 = await createComponentFixture(runId, "c2", 220);
  const c3 = await createComponentFixture(runId, "c3", 440);

  const deletedDirectories: string[] = [];
  const result = await applyStyleMdCurationDecisions(
    {
      runId,
      url: "https://example.com",
      sourceManifestPath: join(runDir, "components", "components_manifest.deduped.json"),
      decisions: [
        {
          type: "single",
          component_id: "c1",
          study_label: "Hero",
          reason: "Primary anchor",
        },
      ],
      components: [c1, c2, c3],
    },
    {
      deleteDirectory: async (directory) => {
        deletedDirectories.push(directory);
      },
    },
  );

  assert.deepEqual(result.keptComponentIds, ["c1"]);
  assert.deepEqual(result.deletedComponentIds, ["c2", "c3"]);
  assert.deepEqual(deletedDirectories.sort(), [c2.directory, c3.directory].sort());

  await rm(runDir, { recursive: true, force: true });
});

test("runCurateStage integration (mocked Claude) writes curated manifest and deletes non-curated components", async () => {
  const runId = makeRunId();
  const runDir = getStyleMdRunDir(runId);
  await mkdir(join(runDir, "components"), { recursive: true });
  await writeText(join(runDir, "full_screenshot.png"), "png");

  const c1 = await createComponentFixture(runId, "c1", 0);
  const c2 = await createComponentFixture(runId, "c2", 220);
  const c3 = await createComponentFixture(runId, "c3", 440);

  const dedupAgentManifestPath = join(runDir, "components", "components_manifest.agent.json");
  await writeText(dedupAgentManifestPath, "{}");

  const output = await runCurateStage({
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

  assert.equal(output.result.curatedManifest.units.length, 2);
  assert.deepEqual(output.result.deletedComponentIds, ["c3"]);
  assert.equal(await fileExists(c3.directory), false);
  assert.equal(await fileExists(output.result.curatedManifestPath), true);
  assert.equal(await fileExists(output.result.promptInputPath), true);
  assert.equal(await fileExists(output.result.responseRawPath), true);
  assert.equal(await fileExists(output.result.decisionsParsedPath), true);
  assert.equal(await fileExists(output.result.decisionsAppliedPath), true);
  assert.equal(await fileExists(join(runDir, "curation", "analysis.pass1.raw.txt")), false);
  assert.equal(await fileExists(join(runDir, "curation", "decision.pass2.raw.txt")), false);

  await rm(runDir, { recursive: true, force: true });
});

test("runCurateStage uses deterministic fallback on invalid Claude output and still completes", async () => {
  const runId = makeRunId();
  const runDir = getStyleMdRunDir(runId);
  await mkdir(join(runDir, "components"), { recursive: true });
  await writeText(join(runDir, "full_screenshot.png"), "png");

  const components: StyleMdComponentEntry[] = [];
  for (let i = 0; i < 8; i += 1) {
    components.push(await createComponentFixture(runId, `c${i + 1}`, i * 220));
  }

  const dedupAgentManifestPath = join(runDir, "components", "components_manifest.agent.json");
  await writeText(dedupAgentManifestPath, "{}");

  const output = await runCurateStage({
    runId,
    url: "https://example.com",
    dedupAgentManifestPath,
    components,
    signal: new AbortController().signal,
    runClaudeQuery: async () => "not-json",
  });

  const parsedPayload = JSON.parse(await readFile(output.result.decisionsParsedPath, "utf8")) as {
    source?: string;
    ok?: boolean;
    units?: unknown[];
  };

  assert.equal(parsedPayload.source, "deterministic_fallback");
  assert.equal(parsedPayload.ok, false);
  assert.ok(Array.isArray(parsedPayload.units));
  assert.ok(output.result.keptComponentIds.length > 0);
  assert.ok(output.result.keptComponentIds.length < components.length);
  assert.equal(await fileExists(output.result.curatedManifestPath), true);

  await rm(runDir, { recursive: true, force: true });
});

test("runCurateStage forwards runtime provider/model/env to query runner", async () => {
  const runId = makeRunId();
  const runDir = getStyleMdRunDir(runId);
  await mkdir(join(runDir, "components"), { recursive: true });
  await writeText(join(runDir, "full_screenshot.png"), "png");

  const c1 = await createComponentFixture(runId, "c1", 0);
  const c2 = await createComponentFixture(runId, "c2", 220);
  const dedupAgentManifestPath = join(runDir, "components", "components_manifest.agent.json");
  await writeText(dedupAgentManifestPath, "{}");

  let capturedRuntime:
    | {
      provider: string;
      model: string;
      queryModel?: string;
      env: Record<string, string | undefined>;
    }
    | undefined;

  await runCurateStage({
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

  assert.equal(capturedRuntime?.provider, "kimi");
  assert.equal(capturedRuntime?.model, "kimi-k2.5");
  assert.equal(capturedRuntime?.queryModel, "kimi-k2.5");
  assert.equal(capturedRuntime?.env.ANTHROPIC_BASE_URL, "https://api.moonshot.ai/anthropic");
  assert.equal(capturedRuntime?.env.ANTHROPIC_AUTH_TOKEN, "sk-test");

  await rm(runDir, { recursive: true, force: true });
});
