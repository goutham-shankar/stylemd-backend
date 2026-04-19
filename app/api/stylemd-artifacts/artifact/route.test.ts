import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { GET } from "@/app/api/stylemd-artifacts/artifact/route";

const RUN_ID = `stylemd_test_${Date.now()}`;

function makeRequest(params: Record<string, string>): Request {
  const url = new URL("http://localhost/api/stylemd-artifacts/artifact");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  return new Request(url.toString());
}

test("GET /api/stylemd-artifacts/artifact blocks path traversal", async () => {
  const runDir = join(process.cwd(), ".playground", "stylemd-artifact-runs", RUN_ID);
  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, "summary.json"), "{}\n");

  try {
    const response = await GET(
      makeRequest({ runId: RUN_ID, path: "../outside.txt", mode: "preview" }),
    );
    const payload = await response.json();
    assert.equal(response.status, 400);
    assert.equal(payload.ok, false);
    assert.match(String(payload.error), /outside run directory/i);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});
