# Artifact Schema

Each run writes to:
- `.playground/stylemd-artifact-runs/<runId>/`

Common files:
- `summary.json`
- `state.json`
- `logs/events.ndjson`

Stage outputs include (when successful):
- `full_screenshot.png`
- `components/` (DOM/style metadata and component screenshots)
- `page_styles/` (stylesheets, localized fonts)
- `curation/` (prompt, raw response, parsed/applied decisions)
- `styleguide/` (prompt, raw response, validation, showcase files)
- `style.md`

Notes:
- Paths are served by `/api/stylemd-artifacts/artifact` and `/styleguide-files/...`.
- Showcase HTML is expected at `styleguide/showcase.html` when available.
