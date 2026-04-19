# Runbook

## Start Local
```bash
npm install
npx playwright install chromium
npm run dev
```

## Verify Core Health
1. Open `/stylemd`.
2. Start a run with `provider=claude` or `provider=kimi`.
3. Confirm live timeline events arrive.
4. Confirm artifact preview loads text/images.
5. Confirm `/styleguide` resolves when showcase is available.

## Common Issues
- Missing provider keys:
  - `ANTHROPIC_API_KEY` required for Claude runs.
  - `KIMI_API_KEY` required for Kimi runs.
- Port in use:
  - run `npm run dev -- --port <port>`.
- Playwright missing browser:
  - run `npx playwright install chromium`.

## Reset State
```bash
curl -X POST http://localhost:3000/api/session/reset
```

## Cost Reporting
```bash
npm run report:stylemd-costs -- --run-id stylemd_<timestamp>
```

## Migrating Existing Runs
```bash
npm run migrate:runs -- --source-root ../design_md/.playground/stylemd-artifact-runs --count 10
```
