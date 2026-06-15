

## 1. Curation — System Prompt

Source: `curation.ts:1069` (`systemPrompt`)

```
You are a deterministic curation engine for style artifact studies.
Use read-only tools to inspect files in the isolated workspace only.
Do not modify or create files.
Select final study units using only workspace artifacts.
Return strict JSON only.
```

---

## 2. Curation — Decision Prompt (user message)

Source: `curation.ts:453` (`buildDecisionPrompt`)

```
Select final curated study units for faithful website reconstruction.
Working directory points to an isolated agent workspace with approved files only.

Inspect these artifacts as needed:
- full_screenshot.png
- components/components_manifest.agent.json
- selected component files under components/<component_id>/

Tool constraints:
- for large text files, use Read with non-negative offset + limit windows

Decision priorities:
- preserve reconstruction-critical layout/composition patterns
- preserve large editorial surfaces, atmospheric sections, and layered background regions
- do NOT aggressively prune whitespace systems or subtle branding surfaces
- prefer clean representative components
- avoid redundant near-duplicates unless structurally different
- downweight popup/modal/chat/cookie contamination unless no clean alternative exists
- merge only when exactly two components are jointly required for one reusable pattern

Output rules:
1. Output must be strict JSON and nothing else.
2. Output schema:
{
  "units": [
    {"type":"single","component_id":"<id>","study_label":"...","reason":"..."},
    {"type":"merge","component_ids":["<idA>","<idB>"],"study_label":"...","reason":"..."}
  ]
}
3. merge must include exactly two distinct component IDs.
4. Each component ID may appear at most once globally across all units.
5. Omitted components will be deleted.
6. Keep study_label concise and reason short.

Prompt context (JSON):
{{ JSON.stringify(promptInput, null, 2) }}
```

---

## 3. Styleguide — Generate `style.md` (user message)

Source: `styleguide.ts:683` (`buildStyleguidePrompt`)

```
Generate final style.md from curated compact evidence.
You are in an isolated read-only workspace containing only approved agent artifacts.
Use only these tools: Read, Grep, Glob, LS.
Never call Agent, WebSearch, WebFetch, Bash, Edit, Write, or MultiEdit.
All file paths are relative to the workspace root. Never prefix paths with '/'.
For large JSON/text files, use Read with non-negative offset + limit windows.

Primary files to inspect (MANDATORY):
- styleguide/evidence.agent.json (Entry point)
- semantic_analysis.json (DESIGN TOKEN SOURCE OF TRUTH)
- semantic_structure.json (PAGE STRUCTURE SOURCE OF TRUTH)
- components/<id>/ (Specific component details)

Output requirements:
1. Output markdown only (DESIGN.md format). The output MUST start with '# ' (an H1 heading).
2. ABSOLUTELY NO RAW CSS: Do NOT copy, quote, or reproduce any CSS rules, selectors, properties, or stylesheet content from the workspace. Describe visual properties in plain English prose only (e.g., write 'buttons use 8px corner radius' not '.btn { border-radius: 8px }').
3. FOCUS ON VISUAL IDENTITY: Use palette, typography, and spacing from semantic_analysis.json as the primary ground truth to preserve brand personality.
4. ATMOSPHERIC DEPTH: Use semantic_structure.json to understand the surface hierarchy (canvas, hero, card, etc.) and preserve visual atmosphere.
5. IDENTIFY BRAND MOOD: Classify the site style (e.g., Cinematic, Brutalist, Luxury, Corporate) based on spacing, typography weight, and shadow usage.
6. COMPOSITED APPEARANCE: Prioritize the 'effective' backgrounds and area-weighted colors over raw CSS values.
7. SNAPPING: Use the normalized/snapped pixel values for spacing and radius.
8. TYPOGRAPHY COVERAGE: Explicitly cover all required observed families from run context.
9. GROUNDING: Every claim MUST be grounded in evidence; use '[unconfirmed]' where evidence is weak or missing.
10. STRUCTURED JSON: At the end of the markdown, include a fenced code block labeled `stylemd-json`. You MUST use ONLY these observed families: {{ required_typography_families.join(", ") }}. Schema: { "typography": { "display": "Font Name", "body": "Font Name", "scale": "modern" | "editorial" }, "fonts": [ { "name": "Font Name", "role": "Display" | "Body" | "UI" | "Mono" } ], "palette": [ { "name": "Label", "hex": "#HEX", "desc": "role" } ], "mood": "MoodName", "radius": "sharp" | "medium" | "pill" | "organic", "spacing": "4px" | "8px" | string, "cornerRadius": "4px" | "8px" | string, "accentColor": "#HEX" }.

Run context (JSON):
{{ JSON.stringify(promptInput, null, 2) }}

Now inspect evidence and write style.md.
```

---

## 4. Styleguide — Retry `style.md` (on quality failure)

Source: `styleguide.ts:717` (`buildRetryPrompt`)

```
Rewrite style.md from evidence with higher coverage and quality.
Use only these tools: Read, Grep, Glob, LS.
Never call Agent.
Use relative paths only; do not prefix '/' on file paths.
For large JSON/text files, use Read with non-negative offset + limit windows.
The prior draft failed these checks:
{{ qualityIssues.map(i => "- " + i) }}

Keep markdown only. The output MUST start with '# ' (H1 heading). ABSOLUTELY NO raw CSS rules, selectors, or stylesheet content anywhere in the output — describe styles in plain English prose only.
ENSURE the `stylemd-json` block is present and accurate at the end.
Use styleguide/evidence.agent.json as source of truth.

Run context (JSON):
{{ JSON.stringify({ run_id, url, unit_count, evidence_agent, required_typography_families }, null, 2) }}

Previous draft:
{{ previousDraft }}
```

---

## 5. Showcase — Generate `showcase.html` (user message)

Source: `styleguide.ts:903` (`buildShowcasePrompt`)

```
Generate a static style showcase HTML page from style.md and compact evidence.
Output HTML only (no markdown fences, no JSON, no preamble).
Use only these tools: Read, Grep, Glob, LS.
Never call Agent.
Use relative workspace paths exactly as provided (for example 'page_styles/fonts.local.css', not '/page_styles/fonts.local.css').
For large JSON/text files, use Read with non-negative offset + limit windows.

Hard constraints:
1. No <script> tags and no JavaScript execution.
2. No external http/https assets.
3. Use local font families from run context and reflect typography faithfully.
4. Keep everything deterministic and self-contained for local rendering.
5. Use plain numeric section labels like '1, 2, 3...' (never use the section symbol).
6. Typography section must explicitly state local WOFF2 loading from '../page_styles/fonts/' and fallback behavior.
7. Layout Containers section must explain why containers exist and when full-bleed layouts can omit them.

Run context (JSON):
{{ JSON.stringify(promptInput, null, 2) }}
```

---

## 6. Showcase — Repair `showcase.html` (on validation failure)

Source: `styleguide.ts:926` (`buildShowcaseRepairPrompt`)

```
Repair the style showcase HTML. This is repair pass {{ passNumber }}.
Output HTML only (no markdown fences, no JSON, no preamble).
Use only these tools: Read, Grep, Glob, LS.
Never call Agent.
Use relative workspace paths exactly as provided.
For large JSON/text files, use Read with non-negative offset + limit windows.

Previous output failed checks:
{{ failedIssues.map(i => "- " + i) }}

Preserve intended visual fidelity, but fix all failures and return one complete HTML document.
Use plain numeric section labels only (no section symbol).
Ensure typography copy explains local fonts from '../page_styles/fonts/' plus fallback behavior.
Ensure Layout Containers copy explains purpose and optional full-bleed usage.

Run context (compact JSON):
{{ JSON.stringify({ run_id, url, evidence_agent, full_screenshot, required_typography_families, font_assets, guardrails }, null, 2) }}

Previous output:
{{ previousTrimmed }}   // previousOutput truncated to 30,000 chars
```

---


