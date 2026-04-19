import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { copyRecentRuns } from "./migrate-stylemd-runs.mjs";

async function makeValidRun(root, runId) {
  const runDir = path.join(root, runId);
  await mkdir(path.join(runDir, "logs"), { recursive: true });
  await writeFile(path.join(runDir, "summary.json"), JSON.stringify({ runId }, null, 2));
  await writeFile(path.join(runDir, "state.json"), JSON.stringify({ runId }, null, 2));
  await writeFile(path.join(runDir, "logs", "events.ndjson"), "{}\n");
}

test("copyRecentRuns copies newest valid stylemd runs and skips corrupt folders", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "stylemd-migrate-"));
  const sourceRoot = path.join(root, "source");
  const destRoot = path.join(root, "dest");
  await mkdir(sourceRoot, { recursive: true });

  await makeValidRun(sourceRoot, "stylemd_100");
  await makeValidRun(sourceRoot, "stylemd_200");
  await makeValidRun(sourceRoot, "stylemd_300");
  await mkdir(path.join(sourceRoot, "stylemd_400"), { recursive: true });

  const result = await copyRecentRuns({
    sourceRoot,
    destRoot,
    count: 3,
    dryRun: false,
    json: false,
  });

  assert.deepEqual(
    result.copied.map((item) => item.runId),
    ["stylemd_300", "stylemd_200", "stylemd_100"],
  );
  assert.equal(result.skipped.some((item) => item.runId === "stylemd_400"), true);

  const copiedSummary = JSON.parse(
    await readFile(path.join(destRoot, "stylemd_300", "summary.json"), "utf8"),
  );
  assert.equal(copiedSummary.runId, "stylemd_300");

  await rm(root, { recursive: true, force: true });
});

test("copyRecentRuns dry-run does not write files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "stylemd-migrate-dry-"));
  const sourceRoot = path.join(root, "source");
  const destRoot = path.join(root, "dest");
  await mkdir(sourceRoot, { recursive: true });
  await makeValidRun(sourceRoot, "stylemd_999");

  const result = await copyRecentRuns({
    sourceRoot,
    destRoot,
    count: 1,
    dryRun: true,
    json: false,
  });

  assert.equal(result.copied.length, 1);
  assert.equal(result.copied[0].dryRun, true);
  await assert.rejects(readFile(path.join(destRoot, "stylemd_999", "summary.json"), "utf8"));

  await rm(root, { recursive: true, force: true });
});
