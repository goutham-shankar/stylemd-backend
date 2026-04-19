import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("stylemd-stage-costs prints token-only report for unknown kimi model", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "stylemd-stage-costs-"));
  const artifactsRoot = path.join(root, "artifacts");
  const claudeProjectsRoot = path.join(root, "claude-projects");
  const runId = "stylemd_1777000000000";
  const runToken = runId.replaceAll("_", "-");
  const runDir = path.join(artifactsRoot, runId);
  const stageDir = path.join(claudeProjectsRoot, `mock-${runToken}-agent-workspace-curate`);

  await mkdir(runDir, { recursive: true });
  await mkdir(stageDir, { recursive: true });

  await writeFile(
    path.join(runDir, "summary.json"),
    JSON.stringify(
      {
        runId,
        provider: "kimi",
        model: "kimi-unknown",
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
      },
      null,
      2,
    ),
  );

  await writeFile(
    path.join(stageDir, "events.jsonl"),
    `${JSON.stringify({
      type: "assistant",
      requestId: "req_1",
      message: {
        model: "kimi-unknown",
        usage: {
          input_tokens: 1200,
          output_tokens: 480,
          cache_read_input_tokens: 100,
          cache_creation_input_tokens: 0,
        },
      },
    })}\n`,
  );

  const stdout = execFileSync(
    "node",
    [
      path.join(process.cwd(), "scripts", "stylemd-stage-costs.mjs"),
      "--run-id",
      runId,
      "--artifacts-root",
      artifactsRoot,
      "--claude-projects-root",
      claudeProjectsRoot,
    ],
    {
      encoding: "utf8",
    },
  );

  assert.match(stdout, /token-only report/i);
  assert.match(stdout, /unknown kimi model/i);
  assert.match(stdout, /\|\s*curate\s*\|/i);
  assert.match(stdout, /\|\s*n\/a\s*\|/i);

  await rm(root, { recursive: true, force: true });
});
