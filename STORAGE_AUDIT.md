# StyleMD Storage Audit & Production Architecture

**Audit date:** 2026-06-16 · **Target:** Hostinger KVM 2 (2 vCPU / 8 GB / ~80 GB disk)

---

## 1 — Executive summary (current state)

| Layer | Size now | Growth rate | Verdict |
|---|---|---|---|
| **MongoDB `scraped_data`** | 1.9 MB / 7 docs (avg 272 KB) | ~250 KB/run | **bloated** — base64 + HTML in DB |
| **MongoDB `stylemd_runs`** | 31.3 MB / 34 docs (avg **943 KB**) | ~1 MB/run | **bloated** — base64 + manifests |
| **Local FS `.playground/`** | **929 MB** / 12,324 files | ~20 MB/run, never cleaned | **leaking** |
| **Local FS `runs/`** | gone (deleted) | — | dead code path still in `app.ts:21` |
| **Redis** | 2 MB used, **no max-memory cap** | bounded by retention | OK for now, risky at scale |
| **R2 `designprobe`** | ~few KB / completed runs | 50–100 KB/run | **healthy**, this is the right place |

**Headline:** Every successful run currently writes ~1.2 MB to Mongo and ~20 MB to local disk that *also* exists in R2. After 1,000 scrapes you'd have ~20 GB of orphaned playground files on disk and ~1.2 GB in Mongo — none of it serving the read path.

---

## 2 — MongoDB audit

### 2.1 Collections

| Collection | Exists? | Purpose |
|---|---|---|
| `scraped_data` | ✅ | URL-keyed cache + status mirror |
| `stylemd_runs` | ✅ | Per-run pipeline metadata (tokens, cost, design tokens) |
| `users` | ❌ | Not implemented — no auth |
| `jobs` | ❌ | BullMQ owns this in Redis |
| `projects` | ❌ | Not implemented |

### 2.2 Per-field byte breakdown (real measurements)

**`scraped_data` (sampled across 7 docs):**

| Field | Avg KB | What it is | Verdict |
|---|---|---|---|
| `rawHtml` | 49 KB (always) | Original page HTML from scrape | **MOVE TO R2** — re-fetchable, rarely read |
| `images[]` | 51–169 KB | Base64 data URL of full screenshot | **MOVE TO R2** — already in R2 as `.jpg` |
| `brandAssets` | 0–59 KB | Base64 logos/favicons | **MOVE TO R2** — binary in JSON is wrong |
| `previewHtml` | 0–59 KB | Final rendered design-system HTML | **DROP** — already in R2 |
| `designMd` | 0–4 KB | Final markdown | **DROP** — already in R2 |
| `contentText` | 6–20 KB | Stripped page text | **KEEP** — useful for search / re-curate |
| `title, h1, description, canonical` | <1 KB each | Page metadata | **KEEP** |
| `url, runId, status, error, dates` | <1 KB | Lookup + status | **KEEP** |

**`stylemd_runs`:** avg **943 KB/doc** — same pattern. Big offenders:
- `styleMd` (markdown text, kept inline)
- `images[]` (base64 — duplicate of scraped_data)
- `screenshot` (base64 — also duplicate)
- `brandAssets` (base64 — also duplicate)
- `extractionMetadata.designTokenManifest` (full Mixed object, can be 100s of KB)
- `extractionMetadata.semanticStructure` (full Mixed object)

### 2.3 Index audit

```
scraped_data:  _id_, url_1                        ← OK
stylemd_runs:  _id_, runId_1, url_1, slug_1       ← drop slug_1 (derivable from url)
```

**Missing indexes** for production queries:
- `scraped_data.status` (for "list all running jobs" admin queries)
- `stylemd_runs.createdAt` desc (for "recent runs" UI)
- `stylemd_runs.url + createdAt` compound (for "show all runs for this URL")

### 2.4 Redundant data across collections

| Field | `scraped_data` | `stylemd_runs` | R2 | Keep where? |
|---|---|---|---|---|
| Full preview HTML | ✅ `previewHtml` | — | ✅ | **R2 only** |
| Design markdown | ✅ `designMd` | ✅ `styleMd` | ✅ | **R2 only** |
| Screenshot | ✅ `images[0]` | ✅ `screenshot` + `images[0]` | ✅ `.jpg` | **R2 only** |
| Raw HTML | ✅ `rawHtml` | — | ❌ | **R2** (as `raw.html`) |
| Brand assets (logos) | ✅ base64 | ✅ base64 | ❌ | **R2** (as `brand/logo.png` etc.) |
| Design tokens (JSON) | — | ✅ `designTokens` | ❌ | **Mongo `stylemd_runs`** — small + queryable |
| Token usage + cost | — | ✅ `tokenUsage`, `costEstimate` | ❌ | **Mongo** — analytics |
| Semantic structure | — | ✅ in extractionMetadata | ❌ | **R2** (`semantic_structure.json`) — large + opaque |
| Token manifest | — | ✅ in extractionMetadata | ❌ | **R2** (`design_tokens.json`) — large |

---

## 3 — Local filesystem audit

### `.playground/stylemd-artifact-runs/<runId>/` — 929 MB across 41 runs, 12,324 files

Per-run breakdown (Apple sample):
```
agent_workspace/         19 MB   Kimi sandbox — components/, semantic copies, evidence.json
components/              7.9 MB  Per-component PNG + metadata.json (50–100 components)
full_screenshot.png      2.4 MB  Source screenshot
page_styles/             736 KB  Captured WOFF2 fonts + CSS
state.json               60 KB   Pipeline state log
styleguide/              44 KB   Kimi styleguide workspace
curation/                20 KB   Kimi curation workspace
semantic_analysis.json   12 KB   Design tokens
semantic_structure.json  8 KB    Sections hierarchy
logs/                    8 KB
```

**Used by:**
- Kimi tools (`Read`/`Glob`/`Grep`) during stages 4–5 — **needs to exist during the run**
- `renderFromRunDir(...)` at stage 6 — reads `semantic_analysis.json` + `semantic_structure.json`
- Never used after the worker completes

**Action:** add post-success cleanup that deletes `<runDir>` after R2 uploads succeed. Keep only `full_screenshot.png` and `semantic_*.json` as R2 uploads (in case we want to re-render later).

### `runs/<slug>/` — directory was deleted
But `backend/src/app.ts:21` still mounts `app.use("/runs", express.static(...))`. Dead code — remove.

---

## 4 — Redis / BullMQ audit

### Current config

```
used_memory:       2.05 MB
maxmemory:         0 (unlimited)
maxmemory-policy:  noeviction       ← correct: never silently drop jobs
DBSIZE:            8 keys
```

### Current retention (`lib/queue/scrapeQueue.ts:9`)

```ts
removeOnComplete: { age: 86400, count: 500 },  // keep 24h or last 500
removeOnFail:    false,                         // keep failed forever
```

### Recommendations

| Setting | Now | Recommended | Why |
|---|---|---|---|
| `maxmemory` | unlimited | **1 GB cap on VPS** | Hard ceiling protects Mongo + worker from OOM domino |
| `maxmemory-policy` | noeviction | keep `noeviction` | Job loss is worse than write failures |
| `appendonly` | (check) | `yes` | Survive VPS reboot |
| `appendfsync` | (check) | `everysec` | Best durability/perf tradeoff |
| `removeOnComplete` | 24h / 500 | **6h / 200** | Mongo holds permanent history anyway |
| `removeOnFail` | forever | **30 days** | After 30d move to Mongo `dead_jobs` collection |

At ~5 KB per completed job in Redis, 200 jobs = 1 MB. Plenty of headroom.

---

## 5 — R2 audit

### Current layout
```
designprobe/
├── <slug>/preview.html
├── <slug>/design.md
└── <slug>/screenshot.jpg
```

### Recommended layout (versioned + namespaced)

```
designprobe/
├── runs/<slug>/<runId>/
│     ├── preview.html              ← rendered design-system HTML
│     ├── design.md                 ← markdown
│     ├── style.md                  ← raw styleguide (if differs)
│     ├── screenshot.jpg            ← full-page JPG
│     ├── raw.html                  ← original scraped HTML (moved from Mongo)
│     ├── semantic_analysis.json    ← design tokens (moved from Mongo)
│     ├── semantic_structure.json   ← sections (moved from Mongo)
│     ├── design_tokens.json        ← stylemd-json (moved from Mongo)
│     └── brand/
│           ├── logo.png
│           ├── favicon.ico
│           └── og.jpg
└── latest/<slug>/                  ← symlink-like alias to most recent run
      └── preview.html
```

**Why versioned (`<runId>` subfolder):**
- Diff old/new generations of the same URL
- Recover from a bad pipeline run
- Cleaner audit trail

**Lifecycle (set on bucket):**
- `runs/*/screenshot.jpg` — 90 days, then move to Glacier-equivalent (R2 has no IA tier; just delete or keep — both effectively free)
- `runs/*/raw.html`, `*.json` — keep 1 year
- `latest/*` — overwrite forever, never expire

**Cache headers (already set in `lib/queue/r2.ts`):**
```
Cache-Control: public, max-age=31536000, immutable
```
✅ Correct — paths are immutable per `<runId>`.

### Public access
Currently using `pub-523e...r2.dev` (rate-limited, dev-only per Cloudflare's own warning). For production: attach a custom domain like `assets.designprobe.io` → swap `R2_PUBLIC_BASE` → code unchanged.

---

## 6 — MongoDB schema recommendations

### `scraped_data` — slimmed cache (target: <5 KB/doc)

```ts
const ScrapedSchema = new mongoose.Schema({
  url:         { type: String, required: true, unique: true, index: true },
  title:       String,
  description: String,
  h1:          String,
  canonical:   String,
  contentText: String,                // small (6–20 KB); useful for search

  runId:       { type: String, index: true },
  status:      { type: String, index: true },  // queued | running | completed | failed
  error:       String,

  // Pointers to R2 artifacts (no inline payloads)
  r2: {
    runDir:       String,             // "runs/<slug>/<runId>"
    previewHtml:  String,             // full public URL
    designMd:     String,
    screenshot:   String,
    rawHtml:      String,
  },

  createdAt:   { type: Date, default: () => new Date(), index: true },
  updatedAt:   { type: Date, default: () => new Date() },
}, { collection: "scraped_data" });
```

**Removed:** `images[]`, `brandAssets{}`, `rawHtml`, `previewHtml`, `designMd`, `runServeUrl` (all moved to R2 refs).

**Result:** ~150 KB → ~3 KB per doc. **50× smaller.**

### `stylemd_runs` — analytics-grade per-run record

```ts
const StyleMdRunSchema = new mongoose.Schema({
  runId:    { type: String, required: true, unique: true, index: true },
  url:      { type: String, required: true, index: true },
  provider: String,
  model:    String,
  status:   { type: String, default: "completed", index: true },

  // The interesting structured output — keep these (small + queryable)
  designTokens: mongoose.Schema.Types.Mixed,      // stylemd-json: palette/typo/mood
  tokenUsage:   mongoose.Schema.Types.Mixed,      // per-stage token counts
  costEstimate: mongoose.Schema.Types.Mixed,      // per-stage $ cost

  // Light summary (not the full manifest)
  summary: {
    primaryColors:       [String],
    typographyFamilies:  [String],
    sectionCount:        Number,
    componentCount:      Number,
    confidenceScore:     Number,
    durationMs:          Number,
    scannedElements:     Number,
  },

  // R2 pointers (full payloads live there)
  r2: {
    runDir:               String,
    styleMd:              String,
    designTokensJson:     String,   // semantic_analysis.json
    semanticStructure:    String,
    screenshot:           String,
    brandAssets: {
      logo:      String,
      favicon:   String,
      appleIcon: String,
      ogImage:   String,
    },
  },

  createdAt: { type: Date, default: () => new Date(), index: true },
  updatedAt: Date,
}, { collection: "stylemd_runs" });

// Compound index for "runs for URL, newest first"
StyleMdRunSchema.index({ url: 1, createdAt: -1 });
```

**Removed:** `slug` index (derivable), `images[]`, `screenshot`, `brandAssets` (base64), `styleMd` (inline), `extractionMetadata.designTokenManifest` + `semanticStructure` (full Mixed).

**Result:** 943 KB → ~10–20 KB per doc. **50–90× smaller.**

### New collection: `dead_jobs` (DLQ archive)

```ts
{
  jobId, url, provider, attemptsMade,
  failedReason: String,
  failedAt:     Date,
  payload:      Mixed,
  pipelineStage: String,  // which stage crashed
  movedFromRedisAt: Date,
}
```

Worker writes here on final failure (after retries exhausted). Cleaner than relying on Redis to keep failed jobs forever.

---

## 7 — Cleanup plan (one-time + ongoing)

### One-time cleanup script

```bash
#!/bin/bash
# scripts/cleanup-storage.sh — run from project root

# 1. Delete orphaned local runs (929 MB → ~50 MB)
find .playground/stylemd-artifact-runs -mindepth 1 -maxdepth 1 -type d \
  -mtime +1 -exec rm -rf {} +

# 2. Delete dead runs/ directory references
rm -rf runs

# 3. Mongo: drop legacy fields on existing docs
mongosh "$MONGO_URI" --eval '
  db.scraped_data.updateMany({}, {$unset: {
    rawHtml: "", previewHtml: "", designMd: "", images: "",
    brandAssets: "", runServeUrl: ""
  }});
  db.stylemd_runs.updateMany({}, {$unset: {
    styleMd: "", images: "", screenshot: "", brandAssets: "",
    "extractionMetadata.designTokenManifest": "",
    "extractionMetadata.semanticStructure": ""
  }});
  db.stylemd_runs.dropIndex("slug_1");
'

# 4. Redis: clear ancient completed jobs
redis-cli --scan --pattern 'bull:scrape:*' | head -1000 | xargs redis-cli DEL
```

### Ongoing — worker-side cleanup hook

Add to `backend/src/worker.ts` after R2 uploads succeed:

```ts
import { rm } from "node:fs/promises";

// After mongo upsert succeeds:
const runDir = getStyleMdRunDir(result.runId);
await rm(runDir, { recursive: true, force: true })
  .catch((e) => console.warn(`[worker] cleanup failed for ${runDir}:`, e.message));
```

Saves ~20 MB per run. At 1k runs that's 20 GB recovered.

### Ongoing — nightly cron (VPS)

```cron
# /etc/cron.d/stylemd-cleanup
0 3 * * * www-data find /opt/stylemd/.playground -mtime +2 -exec rm -rf {} +
0 4 * * * www-data /opt/stylemd/scripts/backup.sh
```

---

## 8 — Backup strategy

### What needs backing up

| Source | Frequency | Method | Destination |
|---|---|---|---|
| **MongoDB** | Daily | `mongodump --gzip --archive` | R2 `backups/mongo/` |
| **Redis AOF** | (continuous) | Built-in | local disk + included in VPS image |
| **R2 itself** | (replicated) | Cloudflare handles | — |
| **`.env` + secrets** | On change | manual to password manager | 1Password / Bitwarden |
| **`ecosystem.config.js` + project code** | Per commit | git | GitHub |

### `scripts/backup.sh`

```bash
#!/bin/bash
set -euo pipefail
TS=$(date +%Y%m%d-%H%M)
TMP=/tmp/mongo-backup-$TS.gz

# 1. Dump
mongodump --uri="$MONGO_URI" --gzip --archive=$TMP

# 2. Upload to R2 via awscli (R2 is S3-compatible)
aws s3 cp $TMP \
  s3://designprobe/backups/mongo/$TS.gz \
  --endpoint-url $R2_ENDPOINT \
  --profile r2-backup

# 3. Cleanup local
rm $TMP

# 4. Retain 30 daily + 12 monthly via lifecycle rule on R2
echo "[backup] uploaded $TS.gz"
```

**R2 backups bucket retention (separate from artifacts):**
- Last 30 daily: keep
- Daily 31–365: keep one per month (lifecycle rule)
- Older than 1 year: delete

At ~50 MB compressed Mongo dump, 30 × 50 MB + 12 × 50 MB = 2.1 GB. Free tier territory.

### Setup once

```bash
# On VPS
sudo apt install -y mongodb-database-tools awscli
aws configure --profile r2-backup
# AWS Access Key ID: <R2 token Access Key ID>
# AWS Secret Access Key: <R2 secret>
# Default region: auto
# Default output format: json
```

---

## 9 — Disaster recovery plan

### 9.1 Mongo corruption / data loss

```bash
# 1. Stop apps
pm2 stop all

# 2. List backups
aws s3 ls s3://designprobe/backups/mongo/ --endpoint-url $R2_ENDPOINT

# 3. Restore latest
aws s3 cp s3://designprobe/backups/mongo/YYYYMMDD-HHMM.gz /tmp/restore.gz \
  --endpoint-url $R2_ENDPOINT
mongorestore --uri="$MONGO_URI" --gzip --archive=/tmp/restore.gz --drop

# 4. Restart
pm2 restart all
```

RTO: ~10 minutes. RPO: 24h (daily backup cadence).

### 9.2 Redis loss (e.g. AOF corruption)

Acceptable loss: any in-flight jobs at moment of crash.

```bash
sudo systemctl stop redis-server
sudo rm /var/lib/redis/dump.rdb /var/lib/redis/appendonly.aof
sudo systemctl start redis-server
# BullMQ producers (API) and consumers (worker) reconnect automatically
# Resubmit any URLs that hadn't completed (visible in Mongo as status=running)
mongosh --eval 'db.scraped_data.find({status:"running"}, {url:1})'
# Re-enqueue those via POST /api/scraped-data
```

RTO: ~5 minutes.

### 9.3 R2 outage / bucket deletion

R2 has 99.999999999% durability — physical loss extremely unlikely. Bigger risk: token leak → attacker deletes objects.

- Mongo holds `r2.previewHtml` URLs but not the bytes
- Recovery = re-run the pipeline for each URL (it's deterministic and idempotent — same slug = same key)
- Automate: `db.scraped_data.find({status:"completed"}).forEach(d => enqueue(d.url, {force:true}))`

RTO: hours (depends on URL count × pipeline duration).

### 9.4 Full VPS loss / Hostinger goes down

```bash
# On new VPS:
git clone <your-repo>
cd stylemd-backend
cp .env.template .env   # fill in from password manager
sudo apt install redis-server mongodb-database-tools
npm install
npm run build
# Restore Mongo
aws s3 cp s3://designprobe/backups/mongo/latest.gz /tmp/r.gz \
  --endpoint-url $R2_ENDPOINT
mongorestore --gzip --archive=/tmp/r.gz
# Start
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup   # auto-start on reboot
```

RTO: ~30 minutes from a fresh Ubuntu install.

---

## 10 — Final recommended architecture

### Component diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                       Hostinger KVM 2 VPS                       │
│                          (2 vCPU / 8 GB)                        │
│                                                                 │
│   ┌──────────────────┐                ┌──────────────────────┐  │
│   │   PM2: api       │   Redis        │   PM2: worker        │  │
│   │   port 3000      │◄──── ─────────►│   no port            │  │
│   │   ~200 MB        │   localhost    │   concurrency=2      │  │
│   │   /api/*         │     6379       │   Playwright +       │  │
│   │   /admin/*       │   1 GB cap     │     Chromium         │  │
│   │   /queues.html   │   AOF on       │   ~1.5–3 GB peak     │  │
│   └────────┬─────────┘                └──────┬───────────────┘  │
│            │                                 │                  │
│            │   ┌─────────────────────────────┴─────┐            │
│            └──►│ MongoDB (localhost:27017)        │            │
│                │  • scraped_data   (3 KB/doc)     │            │
│                │  • stylemd_runs   (15 KB/doc)    │            │
│                │  • dead_jobs      (DLQ archive)  │            │
│                │  Compact, indexed, refs only.    │            │
│                └──────────────┬───────────────────┘            │
│                               │                                 │
│   nightly cron:               │ daily mongodump                 │
│   .playground cleanup ───┐    ▼                                 │
│                          │   /tmp/dump.gz                       │
│                          │                                      │
└──────────────────────────┼──────────────────────────────────────┘
                           │
                           ▼ (all artifacts)
              ┌────────────────────────────────────┐
              │     Cloudflare R2 (designprobe)    │
              │  ┌──────────────────────────────┐  │
              │  │ runs/<slug>/<runId>/         │  │
              │  │   preview.html, design.md    │  │
              │  │   screenshot.jpg, raw.html   │  │
              │  │   semantic_*.json, brand/    │  │
              │  ├──────────────────────────────┤  │
              │  │ latest/<slug>/               │  │
              │  │   preview.html (overwrite)   │  │
              │  ├──────────────────────────────┤  │
              │  │ backups/mongo/               │  │
              │  │   YYYYMMDD-HHMM.gz           │  │
              │  └──────────────────────────────┘  │
              │   Lifecycle: 90d screenshots,      │
              │   1y JSON, 30d+12mo backups        │
              └────────────────────────────────────┘
```

### Data flow per scrape

```
1. POST /api/scraped-data {url}
2. API checks scraped_data.url → if cached + completed → return r2.previewHtml URL (3KB doc read)
3. else: enqueue BullMQ job (jobId = scrape-<slug>)
4. Worker picks up:
   a. Pipeline writes to .playground/<runId>/  (heavy local work)
   b. After success, upload artifacts → R2 runs/<slug>/<runId>/
   c. Update Mongo scraped_data: status=completed, r2.* URLs
   d. Insert stylemd_runs: tokens, costs, design tokens, r2.* URLs
   e. rm -rf .playground/<runId>/                ← cleanup
5. API returns r2.previewHtml from Mongo on next request (cache hit)
```

### Storage targets at 1k runs

| Layer | Before audit | After audit | Reduction |
|---|---|---|---|
| Mongo `scraped_data` | 250 MB | 5 MB | **50×** |
| Mongo `stylemd_runs` | 1 GB | 20 MB | **50×** |
| Local `.playground/` | 20 GB | <100 MB (live runs only) | **200×** |
| R2 artifacts | 50–100 MB | 50–100 MB | same (correct home) |
| Redis | 5 MB | 1 MB | 5× |

**Total VPS disk footprint: 21 GB → 125 MB.** Easy to fit in any cheap tier with room for OS + Mongo working set.

---

## 11 — Implementation checklist (in order)

- [ ] **Schema migration** — `scripts/cleanup-storage.sh` (above)
- [ ] **Update `ScrapedData` model** — slim it per §6
- [ ] **Update `StyleMdRun` model** — slim it per §6
- [ ] **Update worker** — write `r2.*` refs, add `rm -rf` cleanup post-success
- [ ] **Update pipeline writes** — `simplifiedPipeline.ts:160, 424, 758` to write slim schema
- [ ] **Add `dead_jobs` collection** — worker mirrors final-failure jobs there
- [ ] **Drop `app.ts:21`** — `runs/` static mount is dead code
- [ ] **Set `maxmemory 1gb`** in `/etc/redis/redis.conf`
- [ ] **Set `appendonly yes`** in `/etc/redis/redis.conf`
- [ ] **Add `backup.sh`** + cron entry
- [ ] **Configure R2 lifecycle rules** via Cloudflare dashboard
- [ ] **Add missing indexes** (`scraped_data.status`, `stylemd_runs.createdAt`, compound `url+createdAt`)
- [ ] **Custom domain on R2** before prod launch (drop `pub-*.r2.dev`)

Tackle in two waves: **(1) schema + worker cleanup + indexes** (one PR), **(2) backups + cron + lifecycle** (one PR).

---

*Audit complete. Source numbers gathered from live `mongosh` / `redis-cli` / `du` against this project on 2026-06-16.*

---

## 12 — Storage v2 — implementation reference + migration runbook

> **Status:** wave 1 shipped (this PR). Schemas, worker, controller, pipeline writes, and migration tooling all updated to storage v2.

### 12.1 What changed in the codebase

| File | Change |
|---|---|
| [lib/queue/r2.ts](lib/queue/r2.ts) | Added `PIPELINE_VERSION`, `WORKER_VERSION`, `STORAGE_VERSION` constants. Added `r2KeyFor(slug, artifact)` and `r2PublicUrl(key)`. `uploadR2()` now returns the key (not URL). |
| [lib/queue/types.ts](lib/queue/types.ts) | Job result type updated to `{ runId, r2: R2Keys }`. |
| [backend/src/models/ScrapedData.ts](backend/src/models/ScrapedData.ts) | Slim schema. Drops inline `previewHtml`/`designMd`/`rawHtml`/`images`/`brandAssets`. Adds `r2.*` subdoc, version stamps, `lastScrapedAt`, compound `(status, updatedAt)` index. |
| [backend/src/models/StyleMdRun.ts](backend/src/models/StyleMdRun.ts) | Slim schema. Drops inline `styleMd`/`screenshot`/`images`/`brandAssets`/full manifests. Adds `summary` subdoc, `r2.*` subdoc, version stamps, compound `(url, createdAt)` index. |
| [backend/src/worker.ts](backend/src/worker.ts) | Uploads to `websites/{slug}/...`, stores keys in Mongo, deletes `.playground/<runId>/` after success, stamps version fields. |
| [lib/stylemd-artifacts/simplifiedPipeline.ts](lib/stylemd-artifacts/simplifiedPipeline.ts) | Early `scraped_data` upsert now slim (no `rawHtml`/`images`). Screenshot capture no longer persists to Mongo. |
| [lib/services/persistStyleMdMongo.ts](lib/services/persistStyleMdMongo.ts) | Slim upsert — emits `summary` from `extractionMetadata`, drops `styleMd`/`images`/`screenshot`/full manifests. |
| [backend/src/controllers/scrapedData.controller.ts](backend/src/controllers/scrapedData.controller.ts) | Cache-hit 302-redirects to R2 public URL. List endpoint attaches resolved `r2Urls` without mutating stored keys. |
| [backend/src/app.ts](backend/src/app.ts) | Removed dead `/runs` static mount. |
| [scripts/migrate-storage-v2.ts](scripts/migrate-storage-v2.ts) | **New.** Backfills R2 + drops legacy Mongo fields. Idempotent + dry-run. |
| [scripts/apply-indexes.ts](scripts/apply-indexes.ts) | **New.** `syncIndexes()` for both models. |
| [scripts/cleanup-playground.sh](scripts/cleanup-playground.sh) | **New.** Cron-friendly sweep of orphaned `.playground/` dirs. |

### 12.2 Field mapping reference (v1 → v2)

#### scraped_data

| v1 field | v2 location | Notes |
|---|---|---|
| `previewHtml` (inline string) | R2 `websites/{slug}/preview.html` → Mongo `r2.previewHtml` (key) | 0–59 KB → 0 in Mongo |
| `designMd` (inline string) | R2 `websites/{slug}/design.md` → Mongo `r2.designMd` (key) | |
| `rawHtml` (inline string) | R2 `websites/{slug}/raw.html` → Mongo `r2.rawHtml` (key) | 49 KB → 0 in Mongo |
| `images[0]` (base64 data URL) | R2 `websites/{slug}/screenshot.jpg` → Mongo `r2.screenshot` (key) | 50–170 KB → 0 in Mongo |
| `brandAssets.{logo,favicon,…}` (base64) | R2 `websites/{slug}/assets/{...}` → Mongo `r2.assets.*` (keys) | 0–60 KB → 0 in Mongo |
| `runServeUrl` | (deleted — legacy local-FS URL) | |
| `title, description, h1, canonical, contentText` | unchanged (kept inline) | |
| `url, runId, status, error` | unchanged | + new `slug`, `durationMs`, `lastScrapedAt`, `pipelineVersion`, `workerVersion`, `storageVersion` |

#### stylemd_runs

| v1 field | v2 location | Notes |
|---|---|---|
| `styleMd` (inline markdown) | R2 `websites/{slug}/design.md` → Mongo `r2.designMd` (key) | |
| `screenshot` (base64) | R2 `websites/{slug}/screenshot.jpg` → Mongo `r2.screenshot` (key) | |
| `images[]` (base64) | (deleted — duplicate of `screenshot`) | |
| `brandAssets` (base64) | R2 `websites/{slug}/assets/*` → Mongo `r2.assets.*` (keys) | |
| `extractionMetadata.designTokenManifest` | R2 `websites/{slug}/design_tokens.json` → Mongo `r2.designTokens` (key) | Large Mixed object |
| `extractionMetadata.semanticStructure` | R2 `websites/{slug}/semantic_structure.json` → Mongo `r2.semanticStructure` (key) | Large Mixed object |
| `extractionMetadata.{primaryColors, typographyFamilies, sectionCount, confidenceScore, scannedElements, durationMs}` | Flattened into Mongo `summary` + `durationMs` | Tiny, queryable |
| `designTokens, tokenUsage, costEstimate` | unchanged (kept inline) | Analytics-grade, queryable |
| Everything else | unchanged | + new `summary`, `r2.*`, version stamps |

### 12.3 Production migration runbook

**Pre-flight (1 minute):**

```bash
# Confirm Redis is up
redis-cli ping       # → PONG

# Confirm R2 creds work
aws s3 ls s3://designprobe/ --endpoint-url "$R2_ENDPOINT" --profile r2-backup

# Take a fresh Mongo backup before migrating
./scripts/backup.sh   # see §8 — uploads to R2 backups/mongo/
```

**Step 1 — Dry-run the migration (no writes):**

```bash
tsx scripts/migrate-storage-v2.ts --dry-run
```

Expected output:
```
storage migration → v2 (DRY RUN)
bucket=designprobe  pipeline=1.0.0  worker=1.0.0

── migrating scraped_data ──
  [dry] https://apple.com/ → apple.com keys={…}
  [dry] https://dacoit.design/ → dacoit.design keys={…}
  …
── migrating stylemd_runs ──
  …
── summary ──
scraped_data:  scanned=7   migrated=7   uploaded=15  skipped=0
stylemd_runs:  scanned=34  migrated=34  uploaded=21  skipped=0
```

Review the counts. If `migrated == 0` but you have docs, something's off — investigate before going live.

**Step 2 — Live migration:**

```bash
tsx scripts/migrate-storage-v2.ts
```

Properties:
- **Idempotent:** safe to re-run if it crashes
- **Resumable:** Ctrl-C and re-running picks up where it left off (already-migrated docs are detected via `storageVersion == "v2"` + no legacy fields)
- **Read-then-write ordered:** uploads to R2 succeed before legacy fields are `$unset`, so a mid-flight crash never loses data

**Step 3 — Apply indexes:**

```bash
tsx scripts/apply-indexes.ts
```

Verifies and creates: `url_1`, `runId_1`, `status_1` (compound `status + updatedAt`), `createdAt_1`, `(url + createdAt)`. Drops orphan `slug_1` on `stylemd_runs`.

**Step 4 — Restart services (picks up new schema + code):**

```bash
pm2 restart stylemd-api stylemd-worker
```

**Step 5 — Verify:**

```bash
# A. Cache-hit test — should 302 to R2
curl -sI http://localhost:3000/api/scraped-data -X POST \
  -H "Content-Type: application/json" \
  -d '{"url":"https://dacoit.design/"}' | head -5
# Expect: HTTP/1.1 302 Found
# Location: https://pub-…r2.dev/websites/dacoit.design/preview.html

# B. Fresh scrape test — should create a new run, upload, and clean up
curl -s http://localhost:3000/api/scraped-data -X POST \
  -H "Content-Type: application/json" \
  -d '{"url":"https://stripe.com/","force":true}'
# Wait for worker, then check:
ls -la .playground/stylemd-artifact-runs/   # should be empty (or have only in-flight runs)
mongosh --quiet --eval 'db.scraped_data.findOne({url:"https://stripe.com/"}, {r2:1, storageVersion:1, durationMs:1})'
# Expect: storageVersion: "v2", r2.previewHtml: "websites/stripe.com/preview.html", durationMs: <number>
```

**Step 6 — Storage check:**

```bash
mongosh --quiet --eval '
const db = db.getSiblingDB("stylemd");
["scraped_data", "stylemd_runs"].forEach(c => {
  const s = db.runCommand({ collStats: c });
  print(c + ": count=" + s.count + " size=" + (s.size/1024).toFixed(0) + "KB avgObj=" + Math.round(s.avgObjSize/1024) + "KB");
});
'
```

Expected drop: avgObj from 272 KB → ~3 KB (scraped_data), 943 KB → ~15 KB (stylemd_runs).

### 12.4 Rollback plan

If the migration causes issues:

```bash
# 1. Stop services
pm2 stop stylemd-api stylemd-worker

# 2. Restore the pre-migration Mongo backup
aws s3 cp s3://designprobe/backups/mongo/<PRE_MIGRATION_TIMESTAMP>.gz /tmp/restore.gz \
  --endpoint-url "$R2_ENDPOINT" --profile r2-backup
mongorestore --uri="$MONGO_URI" --gzip --archive=/tmp/restore.gz --drop

# 3. Revert the code (git revert the storage-v2 PR)
git revert <commit-sha> && npm run build

# 4. Restart
pm2 restart stylemd-api stylemd-worker
```

R2 objects uploaded by the migration are not deleted by rollback — they're harmless and become useful again when you re-apply the migration.

### 12.5 Backward compatibility during cutover

`strict: false` on both schemas means Mongoose still **reads** legacy fields if they exist. So during the migration:

- ✅ A doc that's been migrated → reads `r2.previewHtml`, gets the key, resolves to URL
- ✅ A doc that hasn't been migrated → has legacy `previewHtml` still inline; cache-check finds no `r2.previewHtml` so it falls through to a cache MISS and re-enqueues a fresh job. The worker writes the v2 shape on completion.
- ✅ The worker writes v2 unconditionally; new runs are always v2 from the moment this PR ships.

**Net effect:** zero user-facing breakage. Stale-cache misses might cause re-scrapes for un-migrated URLs, which is the trade-off — but you ran the migration first, so this should never happen in practice.

After the migration succeeds and you've verified everything for 24-48 hours, you can tighten the schemas:

```ts
// in ScrapedData.ts and StyleMdRun.ts:
{ collection: "...", strict: true }   // ← change back to strict
```

That's wave 3 (optional). Worth doing before you hit BSON write quirks.

### 12.6 What's NOT in storage v2 (planned for v3)

- **Brand asset uploads** — the worker stubs out `r2.assets.*` but the pipeline doesn't yet extract logo/favicon/og.png from the page. When that lands, the worker will upload to `websites/{slug}/assets/logo.png` etc. Same R2 layout, no schema change.
- **`latest/<slug>/` alias** — currently we just overwrite `websites/{slug}/preview.html` on re-scrape. If you want versioned snapshots, switch keys to `websites/{slug}/<runId>/...` and add a worker step to copy to `latest/{slug}/`. Schema already supports it.
- **`dead_jobs` DLQ collection** — failed-job archive from §6 deferred until you have enough failures to care.

### 12.7 Quick sanity checklist after deploy

- [ ] `tsx scripts/migrate-storage-v2.ts --dry-run` reports expected counts
- [ ] `tsx scripts/migrate-storage-v2.ts` (live) reports 0 errors
- [ ] `tsx scripts/apply-indexes.ts` lists all expected indexes
- [ ] `curl -I` on cached URL returns 302 to `https://…r2.dev/websites/…`
- [ ] Force-scrape a new URL — worker logs "cleaned <runDir>" after success
- [ ] `du -sh .playground/stylemd-artifact-runs/` is small (only in-flight)
- [ ] Mongo `db.scraped_data.aggregate([{$group:{_id:null,avg:{$avg:{$bsonSize:"$$ROOT"}}}}])` shows avg doc size < 10 KB

If all 7 pass, storage v2 is live and working.

---

## 13 — Storage v2.1 — asset & artifact cleanup

> **Status:** shipped. Bumps `STORAGE_VERSION` from `v2` to `v2.1`. Removes `raw.html` from default artifacts, adds self-describing `manifest.json`, introduces opt-in `debugMode`.

### 13.1 Headline changes

| Change | Reason |
|---|---|
| **`raw.html` dropped from default artifacts** | Re-fetchable on demand from origin URL; storing every page's HTML wastes R2 bandwidth and Mongo schema surface. |
| **`r2.rawHtml` field removed** from `ScrapedData.r2` + `StyleMdRun.r2` | Nothing reads it; new uploads never write it. |
| **`debugMode: boolean`** opt-in on the scrape request | When `true`, the worker uploads `raw.html` under `websites/{slug}/debug/raw.html`. Off by default. |
| **`manifest.json`** generated for every snapshot | Self-describing index of what's in `websites/{slug}/`. Downstream tools read one file instead of guessing filenames. |
| **Manifest URL NOT stored in Mongo** | Always derivable from `slug` → no schema growth. |

### 13.2 R2 layout (v2.1)

```
designprobe/
└── websites/
     └── {slug}/
          ├── manifest.json            ← always generated
          ├── preview.html
          ├── design.md
          ├── screenshot.jpg
          ├── semantic_structure.json
          ├── design_tokens.json
          ├── assets/                  ← future (v2.2): logo/favicon/og
          │     ├── logo.svg
          │     ├── favicon.ico
          │     └── og-image.jpg
          └── debug/                   ← only present when debugMode=true
                └── raw.html
```

### 13.3 `manifest.json` shape

```json
{
  "domain": "stripe.com",
  "slug": "stripe.com",
  "generatedAt": "2026-06-16T12:34:56.789Z",
  "pipelineVersion": "1.0.0",
  "workerVersion": "1.0.0",
  "storageVersion": "v2.1",
  "artifacts": {
    "previewHtml": "preview.html",
    "designMd": "design.md",
    "screenshot": "screenshot.jpg",
    "designTokens": "design_tokens.json",
    "semanticStructure": "semantic_structure.json"
  },
  "assets": {
    "logo": null,
    "favicon": null,
    "appleIcon": null,
    "ogImage": null
  },
  "debug": { "rawHtml": "debug/raw.html" }
}
```

- Filenames are **relative to `websites/{slug}/`**. Resolve them via `${R2_PUBLIC_BASE}/websites/${slug}/${filename}`.
- Any field whose artifact wasn't produced (e.g. screenshot capture failed) is `null` — consumers should check before linking.
- `debug` is only present when the run was invoked with `debugMode: true`.

### 13.4 API change — request body

```http
POST /api/scraped-data
Content-Type: application/json

{
  "url": "https://stripe.com",
  "provider": "kimi",      // optional, default "kimi"
  "force": false,          // optional, default false
  "debugMode": false       // optional, default false (v2.1+)
}
```

When `debugMode: true`, the worker uploads `raw.html` to `websites/{slug}/debug/raw.html` and the manifest's `debug.rawHtml` field is set. No other behavior changes.

### 13.5 What changed in code (v2 → v2.1)

| File | Change |
|---|---|
| [lib/queue/r2.ts](lib/queue/r2.ts) | `STORAGE_VERSION = "v2.1"`. `R2_ARTIFACT_NAMES` no longer includes `rawHtml`; added `manifest`. New `R2_DEBUG_ARTIFACT_NAMES = { rawHtml: "debug/raw.html" }`. New `buildManifest(...)` helper + `Manifest` type. |
| [lib/queue/types.ts](lib/queue/types.ts) | `R2Keys.rawHtml` removed. `ScrapeJobData.debugMode?: boolean` added. |
| [backend/src/models/ScrapedData.ts](backend/src/models/ScrapedData.ts) | `r2.rawHtml` removed from `R2KeysSchema`. |
| [backend/src/models/StyleMdRun.ts](backend/src/models/StyleMdRun.ts) | `r2.rawHtml` removed from `R2KeysSchema`. |
| [backend/src/worker.ts](backend/src/worker.ts) | Drops unconditional raw.html upload. Reads `job.data.debugMode`; uploads raw.html under `debug/raw.html` only if true. Builds + uploads `manifest.json` last. Manifest path is *not* persisted to Mongo. |
| [backend/src/controllers/scrapedData.controller.ts](backend/src/controllers/scrapedData.controller.ts) | `postSchema` accepts `debugMode`; controller passes it through into the BullMQ job payload. |
| [scripts/migrate-storage-v2.ts](scripts/migrate-storage-v2.ts) | No longer uploads legacy `rawHtml` to R2. `$unset` clauses extended to drop both legacy inline `rawHtml` and any `r2.rawHtml` keys written by v2 worker. Header re-titled v2.1. |

### 13.6 Migration impact

If you already ran the v2 migration: `r2.rawHtml` keys exist in some Mongo docs. Re-run the migration script — it's idempotent and now $unsets those keys. Already-uploaded `websites/{slug}/raw.html` objects in R2 remain (no automated cleanup); delete via R2 console if you want them gone:

```bash
# List existing raw.html objects
aws s3 ls s3://designprobe/websites/ --recursive --endpoint-url "$R2_ENDPOINT" --profile r2-backup \
  | grep '/raw\.html$'

# Bulk delete (review the list first!)
aws s3 ls s3://designprobe/websites/ --recursive --endpoint-url "$R2_ENDPOINT" --profile r2-backup \
  | grep '/raw\.html$' \
  | awk '{print $4}' \
  | xargs -I {} aws s3 rm s3://designprobe/{} --endpoint-url "$R2_ENDPOINT" --profile r2-backup
```

### 13.7 Verification after deploy

```bash
# 1. Fresh non-debug scrape — should NOT produce raw.html
curl -s http://localhost:3000/api/scraped-data -X POST \
  -H "Content-Type: application/json" \
  -d '{"url":"https://stripe.com/","force":true}'
# Wait for completion, then:
aws s3 ls s3://designprobe/websites/stripe.com/ --endpoint-url "$R2_ENDPOINT" --profile r2-backup
# Expect:  manifest.json, preview.html, design.md, screenshot.jpg,
#          design_tokens.json, semantic_structure.json
# Should NOT contain raw.html or debug/

# 2. Debug-mode scrape
curl -s http://localhost:3000/api/scraped-data -X POST \
  -H "Content-Type: application/json" \
  -d '{"url":"https://stripe.com/","force":true,"debugMode":true}'
# After completion:
aws s3 ls s3://designprobe/websites/stripe.com/debug/ --endpoint-url "$R2_ENDPOINT" --profile r2-backup
# Expect: raw.html present

# 3. Manifest sanity check
curl -s "$R2_PUBLIC_BASE/websites/stripe.com/manifest.json" | jq '.storageVersion, .debug // "no debug"'
# Expect: "v2.1" and (the debug block from the debugMode run, or "no debug")

# 4. Mongo schema check
mongosh --quiet --eval '
  const d = db.getSiblingDB("stylemd").scraped_data.findOne({url:"https://stripe.com/"}, {r2:1, storageVersion:1});
  printjson(d);
'
# Expect: storageVersion: "v2.1", r2 has no rawHtml field.
```


