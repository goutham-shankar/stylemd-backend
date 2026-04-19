import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "@/app/api/stylemd-artifacts/run/route";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/stylemd-artifacts/run", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

test("POST /api/stylemd-artifacts/run requires ANTHROPIC_API_KEY when provider=claude", async () => {
  const originalAnthropic = process.env.ANTHROPIC_API_KEY;
  const originalKimi = process.env.KIMI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.KIMI_API_KEY;

  try {
    const response = await POST(makeRequest({ url: "https://example.com", provider: "claude" }));
    const payload = await response.json();
    assert.equal(response.status, 400);
    assert.equal(payload.ok, false);
    assert.match(String(payload.error), /ANTHROPIC_API_KEY/i);
  } finally {
    if (originalAnthropic === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalAnthropic;
    }
    if (originalKimi === undefined) {
      delete process.env.KIMI_API_KEY;
    } else {
      process.env.KIMI_API_KEY = originalKimi;
    }
  }
});

test("POST /api/stylemd-artifacts/run requires KIMI_API_KEY when provider=kimi", async () => {
  const originalAnthropic = process.env.ANTHROPIC_API_KEY;
  const originalKimi = process.env.KIMI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.KIMI_API_KEY;

  try {
    const response = await POST(makeRequest({ url: "https://example.com", provider: "kimi" }));
    const payload = await response.json();
    assert.equal(response.status, 400);
    assert.equal(payload.ok, false);
    assert.match(String(payload.error), /KIMI_API_KEY/i);
  } finally {
    if (originalAnthropic === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalAnthropic;
    }
    if (originalKimi === undefined) {
      delete process.env.KIMI_API_KEY;
    } else {
      process.env.KIMI_API_KEY = originalKimi;
    }
  }
});

test("POST /api/stylemd-artifacts/run defaults provider to claude when omitted", async () => {
  const originalAnthropic = process.env.ANTHROPIC_API_KEY;
  const originalKimi = process.env.KIMI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.KIMI_API_KEY;

  try {
    const response = await POST(makeRequest({ url: "https://example.com" }));
    const payload = await response.json();
    assert.equal(response.status, 400);
    assert.equal(payload.ok, false);
    assert.match(String(payload.error), /provider is claude/i);
  } finally {
    if (originalAnthropic === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalAnthropic;
    }
    if (originalKimi === undefined) {
      delete process.env.KIMI_API_KEY;
    } else {
      process.env.KIMI_API_KEY = originalKimi;
    }
  }
});
