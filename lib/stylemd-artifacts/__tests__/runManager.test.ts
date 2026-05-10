import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { getStyleMdRunDir, readStyleMdSummary } from "@/lib/stylemd-artifacts/artifacts";

function makeRunId(): string {
  return `stylemd_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

test("getStyleMdRunSummary backfills provider/model for legacy summaries", async () => {
  const runId = makeRunId();
  const runDir = getStyleMdRunDir(runId);
  await mkdir(runDir, { recursive: true });

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

  await writeFile(join(runDir, "summary.json"), JSON.stringify(legacySummary, null, 2));

  const summary = await readStyleMdSummary(runId);
  assert.ok(summary);
  assert.equal(summary?.provider, "claude");
  assert.equal(typeof summary?.model, "string");
  assert.ok((summary?.model?.length ?? 0) > 0);

  await rm(runDir, { recursive: true, force: true });
});
