import assert from "node:assert/strict";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { getStyleMdRunDir } from "@/lib/stylemd-artifacts/artifacts";
import {
  runShowcaseStage,
  runStyleguideStage,
  StyleguideStageError,
} from "@/lib/stylemd-artifacts/styleguide";
import type {
  StyleMdComponentEntry,
  StyleMdCuratedManifest,
  StyleMdResponsiveHoverEvidence,
} from "@/lib/stylemd-artifacts/types";

function makeRunId(): string {
  return `stylemd_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function writeText(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value, "utf8");
}

async function createComponentFixture(runId: string, componentId: string, top: number): Promise<StyleMdComponentEntry> {
  const runDir = getStyleMdRunDir(runId);
  const componentDir = join(runDir, "components", componentId);
  await mkdir(componentDir, { recursive: true });

  const screenshotPath = join(componentDir, "screenshot.png");
  const metadataPath = join(componentDir, "metadata.json");
  const domPath = join(componentDir, "dom.html");
  const stylesPath = join(componentDir, "styles.json");
  const styleTreePath = join(componentDir, "style_tree.json");
  const pseudoStylesPath = join(componentDir, "pseudo_styles.json");
  const cssRuleRefsPath = join(componentDir, "css_rule_refs.json");
  const agentDomPath = join(componentDir, "dom.agent.html");
  const agentStylesPath = join(componentDir, "styles.agent.json");
  const agentStyleTreePath = join(componentDir, "style_tree.agent.json");
  const agentPseudoStylesPath = join(componentDir, "pseudo.agent.json");

  await writeText(screenshotPath, "png");
  await writeText(metadataPath, JSON.stringify({ childrenCount: 3, textLength: 60, subtreeElementCount: 12 }, null, 2));
  await writeText(domPath, "<section><h2>Raw DOM</h2></section>");
  await writeText(stylesPath, "{}");
  await writeText(styleTreePath, "[]");
  await writeText(pseudoStylesPath, "{}");
  await writeText(cssRuleRefsPath, "[]");
  await writeText(agentDomPath, "<section><h2>Agent DOM</h2></section>");
  await writeText(agentStylesPath, JSON.stringify({ display: "block", color: "rgb(10, 10, 10)" }, null, 2));
  await writeText(agentStyleTreePath, JSON.stringify([
    {
      nodePath: "section",
      tagName: "section",
      textSample: "Agent DOM",
      rect: { top, left: 0, width: 1200, height: 240, bottom: top + 240 },
      styles: { display: "block" },
    },
  ], null, 2));
  await writeText(agentPseudoStylesPath, JSON.stringify({ before: {}, after: {} }, null, 2));

  return {
    componentId,
    candidateId: `cand_${componentId}`,
    selector: `section.${componentId}`,
    tagName: "section",
    rect: {
      top,
      left: 0,
      width: 1200,
      height: 240,
      bottom: top + 240,
    },
    directory: componentDir,
    screenshotPath,
    metadataPath,
    domPath,
    stylesPath,
    styleTreePath,
    pseudoStylesPath,
    cssRuleRefsPath,
    agentDomPath,
    agentStylesPath,
    agentStyleTreePath,
    agentPseudoStylesPath,
  };
}

function buildCuratedManifest(input: {
  runId: string;
  url: string;
  c1: StyleMdComponentEntry;
  c2: StyleMdComponentEntry;
  sourceManifestPath: string;
}): StyleMdCuratedManifest {
  const { runId, url, c1, c2, sourceManifestPath } = input;
  return {
    run_id: runId,
    url,
    curated_at: new Date().toISOString(),
    source_manifest_path: sourceManifestPath,
    units: [
      {
        unit_id: "unit_001",
        type: "single",
        component_ids: [c1.componentId],
        study_label: "Hero",
        reason: "Primary hero section",
        components: [c1],
      },
      {
        unit_id: "unit_002",
        type: "single",
        component_ids: [c2.componentId],
        study_label: "Feature grid",
        reason: "Secondary editorial section",
        components: [c2],
      },
    ],
    kept_component_ids: [c1.componentId, c2.componentId],
    deleted_component_ids: [],
  };
}

function buildValidMarkdown(): string {
  return [
    "# style.md",
    "",
    "## Aesthetic Direction",
    "Warm editorial commerce look with bold headlines and generous white space.",
    "",
    "## Global System",
    "- Typography mixes bold headings with compact body copy.",
    "- Spacing rhythm alternates between large section gaps and dense card internals.",
    "",
    "## Section Patterns",
    "Hero composition leads with a dominant visual plane, then supporting cards in a secondary rhythm.",
    "",
    "## Components",
    "Buttons are high-contrast CTAs with strong hover differentiation and clear interaction affordance.",
    "",
    "## Responsive + Hover",
    "Desktop keeps multi-column structure, mobile compresses stacks, and hover states intensify color/surface contrast.",
  ].join("\n");
}

function buildValidShowcaseHtml(): string {
  return [
    "<!doctype html>",
    "<html>",
    "<head>",
    "  <meta charset=\"utf-8\" />",
    "  <title>Showcase</title>",
    "  <style>",
    "    body { margin: 0; font-family: serif; background: #f7f4ee; color: #161616; }",
    "    main { max-width: 960px; margin: 0 auto; padding: 48px 24px; }",
    "    h1 { font-size: 48px; margin: 0 0 12px; }",
    "    p { line-height: 1.5; max-width: 68ch; }",
    "  </style>",
    "</head>",
    "<body>",
    "  <main>",
    "    <h1>Editorial Commerce Mood</h1>",
    "    <p>Spacing alternates between large section breaks and tight card internals.</p>",
    "  </main>",
    "</body>",
    "</html>",
  ].join("\n");
}

function buildTypographyShowcaseHtml(): string {
  return [
    "<!doctype html>",
    "<html>",
    "<head>",
    "  <meta charset=\"utf-8\" />",
    "  <title>Typography Showcase</title>",
    "  <style>",
    "    body { margin: 0; }",
    "    .hero { font-family: \"Vivey 22 Positive\"; font-size: 48px; }",
    "    .caption { font-family: \"FHA Condensed French NC\"; font-size: 18px; }",
    "  </style>",
    "</head>",
    "<body>",
    "  <main>",
    "    <h1 class=\"hero\">Ghia</h1>",
    "    <p class=\"caption\">Aperitif</p>",
    "  </main>",
    "</body>",
    "</html>",
  ].join("\n");
}

function buildTypographyMarkdown(): string {
  return [
    "# style.md",
    "",
    "## Typography",
    "- Display family: Vivey 22 Positive for hero statements and high-contrast headlines.",
    "- Accent family: FHA Condensed French NC for compact editorial labels and badges.",
    "",
    "## System",
    "Use generous vertical rhythm with restrained color contrast and clean whitespace.",
  ].join("\n");
}

test("runStyleguideStage integration writes style.md with compact evidence artifacts", async () => {
  const runId = makeRunId();
  const runDir = getStyleMdRunDir(runId);
  await mkdir(join(runDir, "components"), { recursive: true });
  await writeText(join(runDir, "full_screenshot.png"), "png");

  const c1 = await createComponentFixture(runId, "c1", 0);
  const c2 = await createComponentFixture(runId, "c2", 260);
  const curatedManifestPath = join(runDir, "components", "components_manifest.curated.json");
  const curatedManifest = buildCuratedManifest({
    runId,
    url: "https://example.com",
    c1,
    c2,
    sourceManifestPath: curatedManifestPath,
  });
  await writeText(curatedManifestPath, JSON.stringify(curatedManifest, null, 2));

  const responsiveHoverEvidence: StyleMdResponsiveHoverEvidence = {
    run_id: runId,
    url: "https://example.com",
    generated_at: new Date().toISOString(),
    breakpoints: [],
  };
  const responsiveHoverEvidencePath = join(runDir, "styleguide", "evidence.responsive_hover.json");
  await writeText(responsiveHoverEvidencePath, JSON.stringify(responsiveHoverEvidence, null, 2));

  const output = await runStyleguideStage({
    runId,
    url: "https://example.com",
    curatedManifestPath,
    curatedManifest,
    responsiveHoverEvidencePath,
    signal: new AbortController().signal,
    runClaudeQuery: async () => buildValidMarkdown(),
  });

  assert.equal(await fileExists(output.result.styleMdPath), true);
  assert.equal(await fileExists(output.result.promptInputPath), true);
  assert.equal(await fileExists(output.result.responseRawPath), true);
  assert.equal(await fileExists(output.result.validationPath), true);
  assert.equal(await fileExists(output.result.evidenceAgentPath), true);
  assert.equal(await fileExists(output.result.typographyInventoryPath), true);
  assert.equal(await fileExists(join(runDir, "styleguide", "evidence.agent.json")), true);
  assert.equal(await fileExists(join(runDir, "styleguide", "synthesis.pass1.raw.txt")), true);
  assert.equal(output.result.query.failed, false);

  const markdown = await readFile(output.result.styleMdPath, "utf8");
  assert.match(markdown, /## Aesthetic Direction/);

  await rm(runDir, { recursive: true, force: true });
});

test("runShowcaseStage integration writes showcase artifacts after styleguide stage", async () => {
  const runId = makeRunId();
  const runDir = getStyleMdRunDir(runId);
  await mkdir(join(runDir, "components"), { recursive: true });
  await writeText(join(runDir, "full_screenshot.png"), "png");

  const c1 = await createComponentFixture(runId, "c1", 0);
  const c2 = await createComponentFixture(runId, "c2", 260);
  const curatedManifestPath = join(runDir, "components", "components_manifest.curated.json");
  const curatedManifest = buildCuratedManifest({
    runId,
    url: "https://example.com",
    c1,
    c2,
    sourceManifestPath: curatedManifestPath,
  });
  await writeText(curatedManifestPath, JSON.stringify(curatedManifest, null, 2));

  const styleguideOutput = await runStyleguideStage({
    runId,
    url: "https://example.com",
    curatedManifestPath,
    curatedManifest,
    signal: new AbortController().signal,
    runClaudeQuery: async () => buildValidMarkdown(),
  });

  const showcaseOutput = await runShowcaseStage({
    runId,
    url: "https://example.com",
    curatedManifestPath,
    curatedManifest,
    styleMdPath: styleguideOutput.result.styleMdPath,
    styleMarkdown: styleguideOutput.result.styleMarkdown,
    evidenceAgentPath: styleguideOutput.result.evidenceAgentPath,
    typographyInventoryPath: styleguideOutput.result.typographyInventoryPath,
    typographyInventory: styleguideOutput.result.typographyInventory,
    requiredTypographyFamilies: styleguideOutput.result.requiredTypographyFamilies,
    signal: new AbortController().signal,
    runClaudeQuery: async () => buildValidShowcaseHtml(),
  });

  assert.equal(await fileExists(join(runDir, "styleguide", "showcase.prompt_input.json")), true);
  assert.equal(await fileExists(join(runDir, "styleguide", "showcase.response.raw.txt")), true);
  assert.equal(await fileExists(join(runDir, "styleguide", "showcase.validation.json")), true);
  assert.equal(await fileExists(join(runDir, "styleguide", "showcase.html")), true);
  assert.equal(showcaseOutput.result.showcase.available, true);
  assert.equal(showcaseOutput.result.warning, undefined);

  await rm(runDir, { recursive: true, force: true });
});

test("runStyleguideStage retries once when first draft quality is too low", async () => {
  const runId = makeRunId();
  const runDir = getStyleMdRunDir(runId);
  await mkdir(join(runDir, "components"), { recursive: true });
  await writeText(join(runDir, "full_screenshot.png"), "png");

  const c1 = await createComponentFixture(runId, "c1", 0);
  const c2 = await createComponentFixture(runId, "c2", 260);
  const curatedManifestPath = join(runDir, "components", "components_manifest.curated.json");
  const curatedManifest = buildCuratedManifest({
    runId,
    url: "https://example.com",
    c1,
    c2,
    sourceManifestPath: curatedManifestPath,
  });
  await writeText(curatedManifestPath, JSON.stringify(curatedManifest, null, 2));

  let calls = 0;
  const output = await runStyleguideStage({
    runId,
    url: "https://example.com",
    curatedManifestPath,
    curatedManifest,
    signal: new AbortController().signal,
    runClaudeQuery: async () => {
      calls += 1;
      return calls === 1 ? "too short" : buildValidMarkdown();
    },
  });

  assert.equal(calls, 2);
  assert.equal(await fileExists(output.result.styleMdPath), true);
  assert.equal(await fileExists(join(runDir, "styleguide", "synthesis.pass2.raw.txt")), true);

  await rm(runDir, { recursive: true, force: true });
});

test("runStyleguideStage failure persists trace artifacts and does not create fallback style.md", async () => {
  const runId = makeRunId();
  const runDir = getStyleMdRunDir(runId);
  await mkdir(join(runDir, "components"), { recursive: true });
  await writeText(join(runDir, "full_screenshot.png"), "png");

  const c1 = await createComponentFixture(runId, "c1", 0);
  const c2 = await createComponentFixture(runId, "c2", 260);
  const curatedManifestPath = join(runDir, "components", "components_manifest.curated.json");
  const curatedManifest = buildCuratedManifest({
    runId,
    url: "https://example.com",
    c1,
    c2,
    sourceManifestPath: curatedManifestPath,
  });
  await writeText(curatedManifestPath, JSON.stringify(curatedManifest, null, 2));

  await assert.rejects(async () => {
    await runStyleguideStage({
      runId,
      url: "https://example.com",
      curatedManifestPath,
      curatedManifest,
      signal: new AbortController().signal,
      runClaudeQuery: async () => "too short",
    });
  }, (error: unknown) => error instanceof StyleguideStageError);

  assert.equal(await fileExists(join(runDir, "styleguide", "prompt_input.json")), true);
  assert.equal(await fileExists(join(runDir, "styleguide", "evidence.agent.json")), true);
  assert.equal(await fileExists(join(runDir, "styleguide", "response.raw.txt")), true);
  assert.equal(await fileExists(join(runDir, "styleguide", "validation.json")), true);
  assert.equal(await fileExists(join(runDir, "style.md")), false);

  await rm(runDir, { recursive: true, force: true });
});

test("runShowcaseStage keeps style.md but skips showcase when showcase HTML is invalid", async () => {
  const runId = makeRunId();
  const runDir = getStyleMdRunDir(runId);
  await mkdir(join(runDir, "components"), { recursive: true });
  await writeText(join(runDir, "full_screenshot.png"), "png");

  const c1 = await createComponentFixture(runId, "c1", 0);
  const c2 = await createComponentFixture(runId, "c2", 260);
  const curatedManifestPath = join(runDir, "components", "components_manifest.curated.json");
  const curatedManifest = buildCuratedManifest({
    runId,
    url: "https://example.com",
    c1,
    c2,
    sourceManifestPath: curatedManifestPath,
  });
  await writeText(curatedManifestPath, JSON.stringify(curatedManifest, null, 2));

  const styleguideOutput = await runStyleguideStage({
    runId,
    url: "https://example.com",
    curatedManifestPath,
    curatedManifest,
    signal: new AbortController().signal,
    runClaudeQuery: async () => buildValidMarkdown(),
  });

  const output = await runShowcaseStage({
    runId,
    url: "https://example.com",
    curatedManifestPath,
    curatedManifest,
    styleMdPath: styleguideOutput.result.styleMdPath,
    styleMarkdown: styleguideOutput.result.styleMarkdown,
    evidenceAgentPath: styleguideOutput.result.evidenceAgentPath,
    typographyInventoryPath: styleguideOutput.result.typographyInventoryPath,
    typographyInventory: styleguideOutput.result.typographyInventory,
    requiredTypographyFamilies: styleguideOutput.result.requiredTypographyFamilies,
    signal: new AbortController().signal,
    runClaudeQuery: async () => (
      "<html><body><script>alert('x')</script><img src=\"https://example.com/a.png\" /></body></html>"
    ),
  });

  assert.equal(await fileExists(join(runDir, "style.md")), true);
  assert.equal(await fileExists(join(runDir, "styleguide", "showcase.response.raw.txt")), true);
  assert.equal(await fileExists(join(runDir, "styleguide", "showcase.validation.json")), true);
  assert.equal(await fileExists(join(runDir, "styleguide", "showcase.html")), false);
  assert.equal(output.result.showcase.available, false);
  assert.match(output.result.warning ?? "", /Showcase generation failed/i);

  await rm(runDir, { recursive: true, force: true });
});

test("runStyleguideStage resolves required typography families via localized font aliases", async () => {
  const runId = makeRunId();
  const runDir = getStyleMdRunDir(runId);
  await mkdir(join(runDir, "components"), { recursive: true });
  await writeText(join(runDir, "full_screenshot.png"), "png");

  const c1 = await createComponentFixture(runId, "c1", 0);
  const c2 = await createComponentFixture(runId, "c2", 260);

  await writeText(
    c1.agentStylesPath,
    JSON.stringify({ display: "block", "font-family": "\"Vivey 22 Positive\"" }, null, 2),
  );
  await writeText(
    c1.agentStyleTreePath,
    JSON.stringify([
      {
        nodePath: "section",
        tagName: "section",
        textSample: "Hero",
        rect: { top: 0, left: 0, width: 1200, height: 240, bottom: 240 },
        styles: { "font-family": "\"Vivey 22 Positive\"" },
      },
    ], null, 2),
  );
  await writeText(
    c2.agentStylesPath,
    JSON.stringify({ display: "block", "font-family": "\"FHA Condensed French NC\"" }, null, 2),
  );
  await writeText(
    c2.agentStyleTreePath,
    JSON.stringify([
      {
        nodePath: "section",
        tagName: "section",
        textSample: "Caption",
        rect: { top: 260, left: 0, width: 1200, height: 240, bottom: 500 },
        styles: { "font-family": "\"FHA Condensed French NC\"" },
      },
    ], null, 2),
  );

  const curatedManifestPath = join(runDir, "components", "components_manifest.curated.json");
  const curatedManifest = buildCuratedManifest({
    runId,
    url: "https://example.com",
    c1,
    c2,
    sourceManifestPath: curatedManifestPath,
  });
  await writeText(curatedManifestPath, JSON.stringify(curatedManifest, null, 2));

  const localVeveyPath = join(runDir, "page_styles", "fonts", "vevey22_alias.woff2");
  const localFhaPath = join(runDir, "page_styles", "fonts", "fha_alias.woff2");
  await writeText(localVeveyPath, "font");
  await writeText(localFhaPath, "font");
  const fontsManifestPath = join(runDir, "page_styles", "fonts.manifest.json");
  await writeText(
    fontsManifestPath,
    JSON.stringify({
      run_id: runId,
      generated_at: new Date().toISOString(),
      entries: [
        {
          id: "font_0001",
          family: "Vevey22",
          weight: "400",
          style: "normal",
          originalSource: "https://cdn.shopify.com/s/files/1/0338/0785/9852/files/Vevey_22-Positive.ttf?v=1665778565",
          resolvedSource: "https://cdn.shopify.com/s/files/1/0338/0785/9852/files/Vevey_22-Positive.ttf?v=1665778565",
          localArtifactPath: localVeveyPath,
          format: "woff2",
          status: "localized",
        },
        {
          id: "font_0002",
          family: "FHACondensed",
          weight: "700",
          style: "normal",
          originalSource: "https://cdn.shopify.com/s/files/1/0338/0785/9852/files/GHIAFHACondensedFrenchNC-Regular.ttf?v=1697671085",
          resolvedSource: "https://cdn.shopify.com/s/files/1/0338/0785/9852/files/GHIAFHACondensedFrenchNC-Regular.ttf?v=1697671085",
          localArtifactPath: localFhaPath,
          format: "woff2",
          status: "localized",
        },
      ],
      local_css_path: join(runDir, "page_styles", "fonts.local.css"),
      families: [
        { family: "Vevey22", localized_sources: 1 },
        { family: "FHACondensed", localized_sources: 1 },
      ],
    }, null, 2),
  );
  const fontsLocalCssPath = join(runDir, "page_styles", "fonts.local.css");
  await writeText(
    fontsLocalCssPath,
    [
      "@font-face {",
      "  font-family: \"Vevey22\";",
      "  font-style: normal;",
      "  font-weight: 400;",
      "  src: url(\"page_styles/fonts/vevey22_alias.woff2\") format(\"woff2\");",
      "}",
      "@font-face {",
      "  font-family: \"FHACondensed\";",
      "  font-style: normal;",
      "  font-weight: 700;",
      "  src: url(\"page_styles/fonts/fha_alias.woff2\") format(\"woff2\");",
      "}",
    ].join("\n"),
  );

  const styleguideOutput = await runStyleguideStage({
    runId,
    url: "https://example.com",
    curatedManifestPath,
    curatedManifest,
    signal: new AbortController().signal,
    runClaudeQuery: async () => buildTypographyMarkdown(),
  });

  const output = await runShowcaseStage({
    runId,
    url: "https://example.com",
    curatedManifestPath,
    curatedManifest,
    styleMdPath: styleguideOutput.result.styleMdPath,
    styleMarkdown: styleguideOutput.result.styleMarkdown,
    evidenceAgentPath: styleguideOutput.result.evidenceAgentPath,
    typographyInventoryPath: styleguideOutput.result.typographyInventoryPath,
    typographyInventory: styleguideOutput.result.typographyInventory,
    requiredTypographyFamilies: styleguideOutput.result.requiredTypographyFamilies,
    fontsManifestPath,
    fontsLocalCssPath,
    signal: new AbortController().signal,
    runClaudeQuery: async () => buildTypographyShowcaseHtml(),
  });

  assert.equal(output.result.showcase.available, true);
  assert.equal(output.result.warning, undefined);
  assert.equal(await fileExists(join(runDir, "styleguide", "showcase.html")), true);

  await rm(runDir, { recursive: true, force: true });
});

test("runStyleguideStage forwards runtime provider/model/env to query runner", async () => {
  const runId = makeRunId();
  const runDir = getStyleMdRunDir(runId);
  await mkdir(join(runDir, "components"), { recursive: true });
  await writeText(join(runDir, "full_screenshot.png"), "png");

  const c1 = await createComponentFixture(runId, "c1", 0);
  const c2 = await createComponentFixture(runId, "c2", 260);
  const curatedManifestPath = join(runDir, "components", "components_manifest.curated.json");
  const curatedManifest = buildCuratedManifest({
    runId,
    url: "https://example.com",
    c1,
    c2,
    sourceManifestPath: curatedManifestPath,
  });
  await writeText(curatedManifestPath, JSON.stringify(curatedManifest, null, 2));

  let capturedRuntime:
    | {
      provider: string;
      model: string;
      queryModel?: string;
      env: Record<string, string | undefined>;
    }
    | undefined;

  const output = await runStyleguideStage({
    runId,
    url: "https://example.com",
    curatedManifestPath,
    curatedManifest,
    signal: new AbortController().signal,
    runtime: {
      provider: "kimi",
      model: "kimi-k2.5",
      queryModel: "kimi-k2.5",
      env: {
        ANTHROPIC_BASE_URL: "https://api.moonshot.ai/anthropic",
        ANTHROPIC_AUTH_TOKEN: "sk-test",
      },
    },
    runClaudeQuery: async (queryInput) => {
      capturedRuntime = queryInput.runtime;
      return buildValidMarkdown();
    },
  });

  assert.equal(output.result.query.failed, false);
  assert.equal(capturedRuntime?.provider, "kimi");
  assert.equal(capturedRuntime?.model, "kimi-k2.5");
  assert.equal(capturedRuntime?.queryModel, "kimi-k2.5");
  assert.equal(capturedRuntime?.env.ANTHROPIC_BASE_URL, "https://api.moonshot.ai/anthropic");
  assert.equal(capturedRuntime?.env.ANTHROPIC_AUTH_TOKEN, "sk-test");

  await rm(runDir, { recursive: true, force: true });
});

test("runShowcaseStage forwards runtime provider/model/env to query runner", async () => {
  const runId = makeRunId();
  const runDir = getStyleMdRunDir(runId);
  await mkdir(join(runDir, "components"), { recursive: true });
  await writeText(join(runDir, "full_screenshot.png"), "png");

  const c1 = await createComponentFixture(runId, "c1", 0);
  const c2 = await createComponentFixture(runId, "c2", 260);
  const curatedManifestPath = join(runDir, "components", "components_manifest.curated.json");
  const curatedManifest = buildCuratedManifest({
    runId,
    url: "https://example.com",
    c1,
    c2,
    sourceManifestPath: curatedManifestPath,
  });
  await writeText(curatedManifestPath, JSON.stringify(curatedManifest, null, 2));

  const styleguideOutput = await runStyleguideStage({
    runId,
    url: "https://example.com",
    curatedManifestPath,
    curatedManifest,
    signal: new AbortController().signal,
    runClaudeQuery: async () => buildValidMarkdown(),
  });

  let capturedRuntime:
    | {
      provider: string;
      model: string;
      queryModel?: string;
      env: Record<string, string | undefined>;
    }
    | undefined;

  const output = await runShowcaseStage({
    runId,
    url: "https://example.com",
    curatedManifestPath,
    curatedManifest,
    styleMdPath: styleguideOutput.result.styleMdPath,
    styleMarkdown: styleguideOutput.result.styleMarkdown,
    evidenceAgentPath: styleguideOutput.result.evidenceAgentPath,
    typographyInventoryPath: styleguideOutput.result.typographyInventoryPath,
    typographyInventory: styleguideOutput.result.typographyInventory,
    requiredTypographyFamilies: styleguideOutput.result.requiredTypographyFamilies,
    signal: new AbortController().signal,
    runtime: {
      provider: "kimi",
      model: "kimi-k2.5",
      queryModel: "kimi-k2.5",
      env: {
        ANTHROPIC_BASE_URL: "https://api.moonshot.ai/anthropic",
        ANTHROPIC_AUTH_TOKEN: "sk-test",
      },
    },
    runClaudeQuery: async (queryInput) => {
      capturedRuntime = queryInput.runtime;
      return buildValidShowcaseHtml();
    },
  });

  assert.equal(output.result.showcase.available, true);
  assert.equal(capturedRuntime?.provider, "kimi");
  assert.equal(capturedRuntime?.model, "kimi-k2.5");
  assert.equal(capturedRuntime?.queryModel, "kimi-k2.5");
  assert.equal(capturedRuntime?.env.ANTHROPIC_BASE_URL, "https://api.moonshot.ai/anthropic");
  assert.equal(capturedRuntime?.env.ANTHROPIC_AUTH_TOKEN, "sk-test");

  await rm(runDir, { recursive: true, force: true });
});
