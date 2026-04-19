# stylemd-lab

StyleMD Lab is a local app that turns a live website into a structured style artifact package you can inspect, reuse, and iterate on.

## Why this app exists

When you want to study or recreate a site’s visual language, manual inspection is slow and inconsistent. StyleMD Lab gives you one place to generate a style guide/showcase output.

## What it also helps you do

- Compare `claude` vs `kimi` runs for quality/cost.
- See exactly where a run succeeded, failed, or was canceled.
- Browse generated artifacts without digging through folders manually.
- Open the generated showcase page for a run when available.

## Quick start (first time)

1. Install Node.js 24+.
2. Install dependencies:
  ```bash
   npm install
  ```
3. Install Playwright Chromium:
  ```bash
   npx playwright install chromium
  ```
4. Create env file:
  ```bash
   cp .env.example .env.local
  ```
5. Add at least one provider key in `.env.local`:
  - `ANTHROPIC_API_KEY` for Claude runs
  - `KIMI_API_KEY` for Kimi runs
6. Start the app:
  ```bash
   npm run dev
  ```
7. Open [http://localhost:3000/stylemd](http://localhost:3000/stylemd)

## How to use it

1. Paste the website URL.
2. Choose provider (`claude` or `kimi`).
3. Click **Run StyleMD**.
4. Watch live status in the timeline and stage chips.
5. Open artifacts and previews as they arrive.
6. If showcase is available, open `/styleguide` (latest) or `/styleguide/<runId>`.

## How long things usually take

These are practical estimates on a normal local dev machine:

- Setup (first ever): ~5–15 minutes.
- First run for a site: ~4–15 minutes.
- Heavier/complex pages: 15–30+ minutes.
- Re-runs after setup: usually faster than first run.

Notes:

- `styleguide` and `showcase` are often the longest stages.
- You can cancel a run any time from the UI.

## Where outputs go

Run artifacts are written locally to:

- `.playground/stylemd-artifact-runs/<runId>/`

That includes run state/summary, stage logs, extracted assets, and showcase outputs.

## Check a sample output quickly

If you migrated sample runs, use:

- `stylemd_1776233156807`

After starting the app (`npm run dev`):

1. View sample `style.md` in browser:
   - [http://localhost:3000/api/stylemd-artifacts/artifact?runId=stylemd_1776233156807&path=style.md&mode=raw](http://localhost:3000/api/stylemd-artifacts/artifact?runId=stylemd_1776233156807&path=style.md&mode=raw)
2. View sample showcase page:
   - [http://localhost:3000/styleguide/stylemd_1776233156807](http://localhost:3000/styleguide/stylemd_1776233156807)
3. Optional local files:
   - `.playground/stylemd-artifact-runs/stylemd_1776233156807/style.md`
   - `.playground/stylemd-artifact-runs/stylemd_1776233156807/styleguide/showcase.html`

## Useful commands

- Run tests:
  ```bash
  npm run test
  ```
- Lint:
  ```bash
  npm run lint
  ```
- Production build check:
  ```bash
  npm run build
  ```
- Stage token/cost report:
  ```bash
  npm run report:stylemd-costs -- --run-id stylemd_<timestamp>
  ```
- Migrate latest runs from another repo:
  ```bash
  npm run migrate:runs -- --count 10
  ```

## If something seems stuck

- Re-check `.env.local` keys and restart dev server.
- Confirm Chromium is installed (`npx playwright install chromium`).
- Reset UI/session state:
  ```bash
  curl -X POST http://localhost:3000/api/session/reset
  ```

## Want deeper technical details?

- [Architecture](docs/architecture.md)
- [Artifact Schema](docs/artifacts.md)
- [Runbook](docs/runbook.md)
- [Contributing](CONTRIBUTING.md)
