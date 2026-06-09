# StyleMD Backend — API Routes

Base URL: `http://localhost:3002` (or your deployed host)

---

## Health

### `GET /health`
Check if the server is running.

**Response**
```json
{ "ok": true, "status": "running" }
```

---

## StyleMD Pipeline (Simple — blocking, cached)

Use this group for the straightforward request/response flow. The call blocks
until the pipeline finishes (5–10 min). Results are cached by URL in MongoDB.

---

### `POST /api/stylemd`
Run the full StyleMD pipeline for a URL. Returns immediately if the result is
already cached.

**Request body**
```json
{
  "url": "https://example.com",
  "provider": "kimi"
}
```

| Field | Type | Required | Default |
|-------|------|----------|---------|
| `url` | string (valid URL) | yes | — |
| `provider` | `"claude"` \| `"kimi"` | no | `"kimi"` |

**Response `200`**
```json
{
  "ok": true,
  "cached": false,
  "data": {
    "url": "https://example.com",
    "slug": "example",
    "runId": "stylemd_1717000000000_abc123",
    "styleMd": "# Design System\n...",
    "screenshotUrl": "/styleguide-files/stylemd_.../screenshot.png",
    "screenshot": "data:image/png;base64,...",
    "provider": "kimi",
    "model": "kimi-k2-thinking",
    "status": "completed",
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
}
```

**Error responses**

| Status | Reason |
|--------|--------|
| `400` | Invalid URL or missing credentials for provider |
| `500` | Pipeline or database error |

---

### `GET /api/stylemd/runs`
List all completed runs (for a library/history view).

**Response `200`**
```json
{
  "ok": true,
  "summaries": [
    {
      "id": "stylemd_1717000000000_abc123",
      "url": "https://example.com",
      "slug": "example",
      "provider": "kimi",
      "model": "kimi-k2-thinking",
      "status": "completed",
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

---

### `GET /api/stylemd/by-slug/:slug`
Fetch a single completed run by its slug or runId.

**Params**

| Param | Description |
|-------|-------------|
| `slug` | Human-readable slug (e.g. `"example"`) or full `runId` |

**Response `200`**
```json
{
  "ok": true,
  "data": {
    "url": "https://example.com",
    "slug": "example",
    "runId": "stylemd_1717000000000_abc123",
    "styleMd": "# Design System\n...",
    "screenshotUrl": "...",
    "screenshot": "data:image/png;base64,...",
    "provider": "kimi",
    "model": "kimi-k2-thinking",
    "status": "completed",
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
}
```

**Error responses**

| Status | Reason |
|--------|--------|
| `404` | No run found for the given slug |

---

### `DELETE /api/stylemd`
Clear all cached runs from the database.

**Response `200`**
```json
{ "ok": true, "message": "Cache cleared" }
```

---

### `GET /api/stylemd/download-styleguide-v2?runId=:runId`
Download the generated showcase HTML as a self-contained file.

**Query params**

| Param | Type | Required |
|-------|------|----------|
| `runId` | string | yes |

**Response `200`**
- Content-Type: `text/html`
- Content-Disposition: `attachment; filename="styleguide-<runId>.html"`

**Error responses**

| Status | Reason |
|--------|--------|
| `400` | Missing `runId` |
| `404` | Showcase HTML not generated yet for this run |

---

## StyleMD Pipeline (Advanced — SSE, non-blocking)

Use this group when you want real-time progress updates via Server-Sent Events.
Start a run with `POST /api/stylemd-artifacts/run`, then listen for events on
`GET /api/session/events`.

---

### `POST /api/stylemd-artifacts/run`
Start a pipeline run in the background. Does not wait for completion.

**Request body**
```json
{
  "url": "https://example.com",
  "provider": "kimi"
}
```

**Response `200`**
```json
{ "ok": true, "runId": "stylemd_1717000000000_abc123" }
```

**Error responses**

| Status | Reason |
|--------|--------|
| `400` | Invalid URL or missing credentials |
| `409` | Another run is already in progress |

---

### `POST /api/stylemd-artifacts/cancel`
Cancel the currently running pipeline.

**Response `200`**
```json
{ "ok": true }
```

---

### `GET /api/stylemd-artifacts/runs`
List all runs tracked by the in-memory run manager (current session only).

**Response `200`**
```json
{
  "ok": true,
  "summaries": [
    {
      "runId": "stylemd_1717000000000_abc123",
      "url": "https://example.com",
      "status": "completed",
      "provider": "kimi"
    }
  ]
}
```

---

### `GET /api/stylemd-artifacts/runs/:runId`
Get the summary for a specific run.

**Response `200`**
```json
{
  "ok": true,
  "summary": {
    "runId": "stylemd_1717000000000_abc123",
    "url": "https://example.com",
    "status": "completed",
    "provider": "kimi",
    "showcase": {
      "available": true,
      "canonicalUrl": "/styleguide/stylemd_1717000000000_abc123",
      "latestUrl": "/styleguide"
    }
  }
}
```

---

### `GET /api/stylemd-artifacts/artifact?runId=:runId&path=:path&mode=preview|raw`
Fetch a specific artifact file from a run's output directory.

**Query params**

| Param | Type | Required | Default |
|-------|------|----------|---------|
| `runId` | string | yes | — |
| `path` | string | yes | — |
| `mode` | `"preview"` \| `"raw"` | no | `"preview"` |

**Response — preview mode**
```json
{
  "ok": true,
  "previewType": "text",
  "mimeType": "text/plain",
  "truncated": false,
  "content": "..."
}
```
`previewType` is one of `"text"`, `"image"`, `"unsupported"`.

**Response — raw mode**
- Returns the raw file bytes with appropriate `Content-Type`.

---

## Session & SSE Events

### `GET /api/session/events`
Open a Server-Sent Events stream. Connect once on page load and keep alive.
Emits a `state_sync` event immediately on connect with the full current state.

**Connection example**
```js
const es = new EventSource('/api/session/events');
es.onmessage = (e) => {
  const envelope = JSON.parse(e.data);
  // envelope.type = "event" | "state_sync"
  // envelope.payload = PlaygroundEvent | PlaygroundState
};
```

**Envelope shape**
```ts
// State snapshot (sent on connect)
{ type: "state_sync", payload: PlaygroundState }

// Individual event
{ type: "event", payload: PlaygroundEvent }
```

**Event types in `PlaygroundEvent`**

| Event type | Key fields | Description |
|------------|-----------|-------------|
| `stylemd_run_started` | `runId`, `url`, `provider`, `model`, `stages[]`, `startedAt` | Pipeline started |
| `stylemd_stage_started` | `stage`, `startedAt` | A stage began |
| `stylemd_stage_completed` | `stage`, `durationMs` | A stage finished successfully |
| `stylemd_stage_failed` | `stage`, `error` | A stage failed |
| `stylemd_artifact_ready` | `artifact.path`, `artifact.label` | An output file is ready |
| `stylemd_action` | `level` (`info`\|`warn`\|`error`), `message` | Log message from the pipeline |
| `stylemd_run_completed` | `runId`, `status`, `error`, `warnings`, `showcase` | Pipeline finished |
| `session_reset` | `reason` | Session was cleared |

**Pipeline stages** (in order)
```
capture → extract → dedup → curate → responsive → styleguide → showcase
```

---

### `POST /api/session/reset`
Reset the session state (clears in-memory run state and broadcasts a
`session_reset` event to all SSE listeners).

**Response `200`**
```json
{ "ok": true }
```

---

## Web Scraping

### `POST /api/scraped-data`
Scrape a URL and store the result. Returns cached data if already scraped.

**Request body**
```json
{
  "url": "https://example.com",
  "force": false
}
```

| Field | Type | Required | Default |
|-------|------|----------|---------|
| `url` | string (valid URL) | yes | — |
| `force` | boolean | no | `false` |

**Response `201`** (new) / **`200`** (cached)
```json
{
  "ok": true,
  "cached": true,
  "data": {
    "url": "https://example.com",
    "title": "Example Domain",
    "description": "...",
    "h1": "Example Domain",
    "canonical": "https://example.com",
    "images": ["data:image/png;base64,..."],
    "contentText": "...",
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
}
```

Note: `rawHtml` is excluded from list responses to keep payloads small.

---

### `GET /api/scraped-data`
List the 100 most recently scraped pages (no `rawHtml`).

**Response `200`**
```json
{
  "ok": true,
  "data": [ { "url": "...", "title": "...", "createdAt": "..." } ]
}
```

---

## Static File Routes

| Route | Description |
|-------|-------------|
| `GET /styleguide` | Redirects to the latest completed showcase |
| `GET /styleguide/:runId` | Renders the showcase viewer page for a specific run |
| `GET /styleguide-files/:runId/*` | Serves raw artifact files (HTML, CSS, fonts, images) for a run |

---

## Error format

All API errors follow this shape:

```json
{ "ok": false, "error": "Human-readable error message" }
```
