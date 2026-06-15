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
