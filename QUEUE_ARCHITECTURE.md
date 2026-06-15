# StyleMD — Queue Architecture (Redis + BullMQ + R2)

Single doc. Target: Hostinger KVM 2 (2 vCPU, 8 GB RAM), Cloudflare R2.
Replaces the inline background pipeline in `scrapedData.controller.ts` with an async queue.

---

# 1. Architecture.md (updated)

## Before (current)
API receives POST → marks Mongo `running` → runs `runSimplifiedStyleMdPipeline` inline via `void (async()=>…)`. Pipeline = scrape→extract→dedup→curate→styleguide→render. No backpressure: N requests = N concurrent Playwright browsers → OOM on 8 GB.

## After (queued)
```
Frontend
  ↓ POST /api/scraped-data {url,userId}
API Layer (Express)              validate (zod) → enqueue → return 202 {jobId}
  ↓ queue.add()
BullMQ (Node lib)                schedule, retry, concurrency, DLQ
  ↓
Redis                            broker + job state + progress + metrics
  ↓ Worker.process()
Worker Pool (concurrency=2)
  ↓
Playwright                       scrape (1 browser per active job)
  ↓
Asset Generation                 HTML (designSystemRenderer) + Markdown + Screenshot
  ↓ S3 PutObject
Cloudflare R2                    preview.html, design.md, screenshot.jpg
  ↓
Metadata Storage (MongoDB)       job record + R2 refs + status
  ↓
Job Completion                   progress=100, event published
```

## Component map (existing → new)
| Concern | Today | After |
|---|---|---|
| Enqueue | controller inline | `scrapeQueue.add()` |
| Run pipeline | `void async` in request | `scrapeWorker` process fn |
| Browser | `scraper.ts` | unchanged, called by worker |
| Render | `designSystemRenderer.ts` | unchanged, called by worker |
| Output store | `runs/<slug>/` local FS | R2 bucket + Mongo refs |
| Status | Mongo `status` field | BullMQ state + Mongo mirror |

## Data stores
- **Redis** — queue, job payloads, progress, locks, metrics counters. Ephemeral but persisted (AOF).
- **MongoDB** — durable metadata (job record §8), source of truth for history/dashboard reads.
- **R2** — generated assets (immutable, served via CDN/signed URL).

---

# 2. Queue Architecture

## Queues
| Queue | Purpose | Concurrency |
|---|---|---|
| `scrape` | main scrape→render→upload jobs | 2 |
| `scrape-dlq` | dead letter: permanently failed | 1 (manual/replay) |

(Single main queue is enough at this scale. Split later if CPU-bound render needs isolating from IO-bound scrape.)

## Job states (BullMQ native)
`waiting` → `active` → `completed` | `failed` → (retries exhausted) → moved to `scrape-dlq`.
Also: `delayed` (backoff wait), `paused` (queue drained for shutdown).

## Lifecycle
```
add() → waiting ──pick──> active ──ok──> completed (keep 24h / 500)
                            │
                            └─err─> failed ──attempts<max?── delayed(backoff) → waiting
                                              └─attempts==max─> DLQ + Mongo status=dead
```

## Retries & backoff
```ts
defaultJobOptions: {
  attempts: 3,
  backoff: { type: "exponential", delay: 15_000 }, // 15s, 30s, 60s
  removeOnComplete: { age: 86400, count: 500 },
  removeOnFail: false, // keep for DLQ inspection
}
```
Retry only **transient** errors (nav timeout, 5xx, ECONN). Mark **permanent** errors (invalid URL, 404, blocked) `attempts:1` via per-job override or `UnrecoverableError` (BullMQ stops retrying).

## Dead Letter Queue
On `failed` event with `job.attemptsMade >= attempts`: copy job to `scrape-dlq`, set Mongo `status=dead`, store `error`. DLQ jobs are not auto-run; admin can **replay** (re-add to `scrape`) or **purge**.

## Progress & queue position
- Progress: `job.updateProgress(pct)` at each stage (table §Worker). Read via `job.progress`.
- Position: `await queue.getWaiting()` index, or `job.getState()` + count of waiting jobs ahead. Expose `GET /api/jobs/:id` → `{state, progress, position}`.

## Job ID
Deterministic per URL+user to dedupe in-flight: `jobId = scrape:{userId}:{sha1(canonUrl)}`. BullMQ rejects duplicate active/waiting IDs → free idempotency (replaces the current Mongo `status==="running"` 409 check).

---

# 3. Worker Design

## Concurrency (2 vCPU / 8 GB)
Chromium ≈ 350–600 MB RSS per page. Budget: OS+Node+Mongo client ≈ 1.5 GB; leave 1.5 GB headroom → ~5 GB for browsers → cap **2 concurrent**. CPU: scrape+render is bursty; 2 keeps both cores busy without thrash.
```ts
new Worker("scrape", processor, { concurrency: 2, connection });
```

## Stage progress contract
| Stage | progress | note |
|---|---|---|
| picked up | 5 | active |
| playwright scrape | 30 | 1 browser |
| extract/curate/styleguide | 55 | reuse pipeline |
| HTML gen | 70 | designSystemRenderer |
| Markdown gen | 78 | renderDesignMd |
| screenshot | 85 | already from scraper |
| R2 upload | 95 | put 3 objects |
| mongo update | 100 | completed |

## Backpressure
- Bounded accept: if `waiting > MAX_QUEUE (e.g. 500)` → API returns `429 queue full`.
- BullMQ rate limit guards Redis: `limiter: { max: 50, duration: 1000 }`.
- Single browser per active job; never launch ad-hoc browsers outside the worker.

## Memory protection
- One Playwright `browser` per job, **always** `await browser.close()` in `finally` (already in `scraper.ts`).
- Per-job hard timeout: `job.opts.timeout` not native → wrap processor in `Promise.race([work, timeout(180_000)])`; on timeout throw → retry/DLQ.
- Restart worker process after N jobs to defeat leaks: `if (++done % 200 === 0) process.exit(0)` (PM2/systemd respawns). Or `--max-old-space-size=1024`.
- Reject pages >X MB (scraper already skips images >1 MB).

## Graceful shutdown
```ts
async function shutdown() {
  await worker.close();        // stop picking, finish active (BullMQ waits)
  await queue.close();
  await redis.quit();
  await mongoose.disconnect();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
```
Active jobs finish or, if killed mid-flight, their lock expires (`lockDuration` 30s, renewed) → BullMQ re-queues as `stalled` → auto-reprocessed.

---

# 4. Admin Dashboard Specification

## Metrics (source)
| Card | Source |
|---|---|
| Total queued | `queue.getWaitingCount()` |
| Active | `queue.getActiveCount()` |
| Completed | `queue.getCompletedCount()` |
| Failed | `queue.getFailedCount()` + DLQ count |
| Worker status | heartbeat key `worker:{id}:hb` (TTL 15s) → online/offline |
| Redis health | `redis.ping()` + `INFO memory` (used/maxmemory) |
| Avg processing time | rolling avg of `completed.finishedOn - processedOn` (last 100) |
| Throughput | completed count in last 60s (Redis sorted set of finish times) |
| Recent activity | `queue.getJobs(["completed","failed","active"], 0, 20)` |

## API (admin, auth-gated)
```
GET /api/admin/queue/stats        → all counters above
GET /api/admin/queue/jobs?state=  → paginated jobs
GET /api/admin/jobs/:id           → full job + progress + logs
POST /api/admin/dlq/:id/replay    → re-add to scrape
DELETE /api/admin/dlq/:id         → purge
POST /api/admin/queue/pause|resume
```

## UI
- Top: 8 stat cards (auto-refresh 3s via SSE or poll).
- Table: recent jobs (id, userId, url, state, progress bar, durations, R2 links, error).
- Worker panel: per-worker hb, current job, mem.
- **Fast path:** mount **Bull Board** (`@bull-board/express`) at `/admin/queues` for a ready-made UI; build the custom cards on top for product metrics.

---

# 5. Job Record (§8)

```ts
interface ScrapeJob {
  jobId: string;            // scrape:{userId}:{sha1(url)}
  userId: string;
  url: string;              // canonical
  status: "waiting"|"active"|"completed"|"failed"|"dead";
  progress: number;         // 0–100
  createdAt: Date;
  startedAt?: Date;         // processedOn
  completedAt?: Date;       // finishedOn
  attemptsMade: number;
  r2: { previewHtml?: string; designMd?: string; screenshot?: string }; // R2 keys/URLs
  error?: { message: string; stack?: string; permanent: boolean };
}
```
Mirror in Mongo collection `scrape_jobs` (BullMQ data is ephemeral). Update on `active`/`completed`/`failed` queue events via a `QueueEvents` listener → durable history + dashboard reads don't hit Redis hot path.

---

# 6. Redis / BullMQ Integration Guide

## Deps
```
npm i bullmq ioredis @aws-sdk/client-s3 @bull-board/express @bull-board/api
```

## Redis (Hostinger VPS, local)
```conf
# /etc/redis/redis.conf
maxmemory 1gb
maxmemory-policy noeviction        # never drop queue jobs
appendonly yes                     # AOF persistence
appendfsync everysec
save 900 1                         # RDB snapshot backup
bind 127.0.0.1                     # local only; no public exposure
requirepass <strong>
```

## Connection
```ts
// lib/queue/redis.ts
import IORedis from "ioredis";
export const connection = new IORedis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: null,      // required by BullMQ workers
  enableReadyCheck: false,
});
```

## Queue + producer (replaces inline run in controller)
```ts
// lib/queue/scrapeQueue.ts
import { Queue } from "bullmq";
import { connection } from "./redis";
export const scrapeQueue = new Queue("scrape", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 15_000 },
    removeOnComplete: { age: 86400, count: 500 },
    removeOnFail: false,
  },
});
```
```ts
// scrapedData.controller.ts (createScrapedData) — replace background block
const { url, userId } = parsed;
const canon = canonicalPageUrl(url);
const jobId = `scrape:${userId}:${sha1(canon)}`;
if ((await scrapeQueue.getWaitingCount()) > 500)
  return res.status(429).json({ ok:false, error:"queue full" });
await scrapeQueue.add("scrape", { url: canon, userId }, { jobId });
res.status(202).json({ ok:true, jobId, status:"queued" });
```

## Worker (separate process: `backend/src/worker.ts`, own PM2 app)
```ts
import { Worker, UnrecoverableError } from "bullmq";
import { connection } from "@/lib/queue/redis";
import { runSimplifiedStyleMdPipeline } from "@/lib/stylemd-artifacts/simplifiedPipeline";
import { renderFromRunDir } from "@/backend/src/services/designSystemRenderer";
import { uploadR2 } from "@/lib/queue/r2";

const worker = new Worker("scrape", async (job) => {
  const { url } = job.data;
  await job.updateProgress(5);
  const result = await runSimplifiedStyleMdPipeline(url, "kimi", job.id!);   // scrape+pipeline
  await job.updateProgress(70);
  const rendered = await renderFromRunDir(getStyleMdRunDir(result.runId), url); // html+md
  if (!rendered) throw new UnrecoverableError("render produced no output");
  await job.updateProgress(85);
  const r2 = {
    previewHtml: await uploadR2(`${job.id}/preview.html`, rendered.html, "text/html"),
    designMd:    await uploadR2(`${job.id}/design.md`,   rendered.md,   "text/markdown"),
    screenshot:  await uploadR2(`${job.id}/screenshot.jpg`, result.screenshot, "image/jpeg"),
  };
  await job.updateProgress(95);
  await safeWrite(() => ScrapedData.updateOne({ url }, { $set: { status:"completed", r2, runId: result.runId, updatedAt: new Date() }}));
  await job.updateProgress(100);
  return r2;
}, { connection, concurrency: 2, lockDuration: 30_000, limiter: { max: 50, duration: 1000 } });
```

## R2 upload (S3-compatible)
```ts
// lib/queue/r2.ts
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,            // https://<acct>.r2.cloudflarestorage.com
  credentials: { accessKeyId: process.env.R2_KEY!, secretAccessKey: process.env.R2_SECRET! },
});
export async function uploadR2(key: string, body: string|Buffer, ct: string) {
  await s3.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key, Body: body, ContentType: ct }));
  return `${process.env.R2_PUBLIC_BASE}/${key}`;   // or generate signed URL
}
```

## DLQ + Mongo mirror (QueueEvents listener, in worker process)
```ts
import { QueueEvents } from "bullmq";
const ev = new QueueEvents("scrape", { connection });
ev.on("failed", async ({ jobId, failedReason }) => {
  const job = await scrapeQueue.getJob(jobId);
  if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
    await dlqQueue.add("dead", { ...job.data, error: failedReason }, { jobId });
    await ScrapedData.updateOne({ url: job.data.url }, { $set: { status:"dead", error: failedReason }});
  }
});
ev.on("completed", async ({ jobId }) => { /* mirror completedAt */ });
```

## Progress to frontend
Poll `GET /api/jobs/:id` (`job.getState()`, `job.progress`) or push via SSE using `QueueEvents` `progress`/`completed`.

---

# 7. Recovery & Fault Tolerance

| Failure | Mechanism |
|---|---|
| Redis restart | AOF (`appendonly yes`) replays jobs; `noeviction` prevents loss |
| Worker crash mid-job | lock expires → job becomes `stalled` → auto re-queued (`maxStalledCount: 1`) |
| Transient scrape error | exponential retry ×3 |
| Permanent failure | DLQ + Mongo `status=dead`, manual replay |
| VPS reboot | systemd/PM2 `restart: always` brings up Redis, API, worker; queue state restored from Redis AOF |
| Queue state | lives in Redis (persisted) + mirrored to Mongo for history |
| Poison job (always crashes worker) | `maxStalledCount` + attempts cap → DLQ, doesn't loop forever |

Backups: cron `redis RDB` snapshot → R2 daily; Mongo is source of truth for completed metadata.

---

# 8. Scaling Recommendations (KVM 2: 2 vCPU / 8 GB)

| Setting | Value | Why |
|---|---|---|
| Worker concurrency | **2** | ~600 MB/Chromium, fits 8 GB w/ headroom |
| Redis maxmemory | 1 GB | queue + metrics; noeviction |
| Max waiting | 500 | backpressure → 429 beyond |
| Job timeout | 180 s | kill stuck scrapes |
| Worker recycle | every 200 jobs | leak defense |
| Node heap | `--max-old-space-size=1024` per proc | bound RSS |
| Processes (PM2) | api ×1, worker ×1, redis (system) | isolate crashes |

## Process layout
```
PM2: stylemd-api (Express)   — enqueues, serves dashboard, never launches Playwright
PM2: stylemd-worker (BullMQ) — concurrency 2, owns all Playwright
systemd: redis-server        — AOF, localhost only
```

## Throughput
~2 jobs in parallel, ~60–120 s each → **~60–120 jobs/hour**. Queue absorbs hundreds; they drain in order.

## Scaling up
1. Bigger VPS (4 vCPU/16 GB) → concurrency 4.
2. Add worker VPS pointing at same Redis (BullMQ is multi-worker native) → linear scale; Redis stays single broker.
3. Move Redis to managed/Upstash if >1 worker host.
4. Split CPU-bound render into its own queue if browsers starve.
5. R2 already scales infinitely; serve assets via Cloudflare CDN, not the VPS.

## Cost guardrail
Each full pipeline run also costs Kimi tokens (~$0.15–0.40). Queue concurrency caps **spend rate**, not just RAM — 2 workers ≈ max ~$0.8/hr AI spend at full saturation.
