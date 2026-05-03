"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const node_test_1 = __importDefault(require("node:test"));
const artifacts_1 = require("@/lib/stylemd-artifacts/artifacts");
const styleguide_1 = require("@/lib/stylemd-artifacts/styleguide");
function makeRunId() {
    return `stylemd_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
async function fileExists(path) {
    try {
        await (0, promises_1.stat)(path);
        return true;
    }
    catch {
        return false;
    }
}
async function writeText(path, value) {
    await (0, promises_1.mkdir)((0, node_path_1.dirname)(path), { recursive: true });
    await (0, promises_1.writeFile)(path, value, "utf8");
}
async function createComponentFixture(runId, componentId, top) {
    const runDir = (0, artifacts_1.getStyleMdRunDir)(runId);
    const componentDir = (0, node_path_1.join)(runDir, "components", componentId);
    await (0, promises_1.mkdir)(componentDir, { recursive: true });
    const screenshotPath = (0, node_path_1.join)(componentDir, "screenshot.png");
    const metadataPath = (0, node_path_1.join)(componentDir, "metadata.json");
    const domPath = (0, node_path_1.join)(componentDir, "dom.html");
    const stylesPath = (0, node_path_1.join)(componentDir, "styles.json");
    const styleTreePath = (0, node_path_1.join)(componentDir, "style_tree.json");
    const pseudoStylesPath = (0, node_path_1.join)(componentDir, "pseudo_styles.json");
    const cssRuleRefsPath = (0, node_path_1.join)(componentDir, "css_rule_refs.json");
    const agentDomPath = (0, node_path_1.join)(componentDir, "dom.agent.html");
    const agentStylesPath = (0, node_path_1.join)(componentDir, "styles.agent.json");
    const agentStyleTreePath = (0, node_path_1.join)(componentDir, "style_tree.agent.json");
    const agentPseudoStylesPath = (0, node_path_1.join)(componentDir, "pseudo.agent.json");
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
function buildCuratedManifest(input) {
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
function buildValidMarkdown() {
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
function buildValidShowcaseHtml() {
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
function buildTypographyShowcaseHtml() {
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
function buildTypographyMarkdown() {
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
(0, node_test_1.default)("runStyleguideStage integration writes style.md with compact evidence artifacts", async () => {
    const runId = makeRunId();
    const runDir = (0, artifacts_1.getStyleMdRunDir)(runId);
    await (0, promises_1.mkdir)((0, node_path_1.join)(runDir, "components"), { recursive: true });
    await writeText((0, node_path_1.join)(runDir, "full_screenshot.png"), "png");
    const c1 = await createComponentFixture(runId, "c1", 0);
    const c2 = await createComponentFixture(runId, "c2", 260);
    const curatedManifestPath = (0, node_path_1.join)(runDir, "components", "components_manifest.curated.json");
    const curatedManifest = buildCuratedManifest({
        runId,
        url: "https://example.com",
        c1,
        c2,
        sourceManifestPath: curatedManifestPath,
    });
    await writeText(curatedManifestPath, JSON.stringify(curatedManifest, null, 2));
    const responsiveHoverEvidence = {
        run_id: runId,
        url: "https://example.com",
        generated_at: new Date().toISOString(),
        breakpoints: [],
    };
    const responsiveHoverEvidencePath = (0, node_path_1.join)(runDir, "styleguide", "evidence.responsive_hover.json");
    await writeText(responsiveHoverEvidencePath, JSON.stringify(responsiveHoverEvidence, null, 2));
    const output = await (0, styleguide_1.runStyleguideStage)({
        runId,
        url: "https://example.com",
        curatedManifestPath,
        curatedManifest,
        responsiveHoverEvidencePath,
        signal: new AbortController().signal,
        runClaudeQuery: async () => buildValidMarkdown(),
    });
    strict_1.default.equal(await fileExists(output.result.styleMdPath), true);
    strict_1.default.equal(await fileExists(output.result.promptInputPath), true);
    strict_1.default.equal(await fileExists(output.result.responseRawPath), true);
    strict_1.default.equal(await fileExists(output.result.validationPath), true);
    strict_1.default.equal(await fileExists(output.result.evidenceAgentPath), true);
    strict_1.default.equal(await fileExists(output.result.typographyInventoryPath), true);
    strict_1.default.equal(await fileExists((0, node_path_1.join)(runDir, "styleguide", "evidence.agent.json")), true);
    strict_1.default.equal(await fileExists((0, node_path_1.join)(runDir, "styleguide", "synthesis.pass1.raw.txt")), true);
    strict_1.default.equal(output.result.query.failed, false);
    const markdown = await (0, promises_1.readFile)(output.result.styleMdPath, "utf8");
    strict_1.default.match(markdown, /## Aesthetic Direction/);
    await (0, promises_1.rm)(runDir, { recursive: true, force: true });
});
(0, node_test_1.default)("runShowcaseStage integration writes showcase artifacts after styleguide stage", async () => {
    const runId = makeRunId();
    const runDir = (0, artifacts_1.getStyleMdRunDir)(runId);
    await (0, promises_1.mkdir)((0, node_path_1.join)(runDir, "components"), { recursive: true });
    await writeText((0, node_path_1.join)(runDir, "full_screenshot.png"), "png");
    const c1 = await createComponentFixture(runId, "c1", 0);
    const c2 = await createComponentFixture(runId, "c2", 260);
    const curatedManifestPath = (0, node_path_1.join)(runDir, "components", "components_manifest.curated.json");
    const curatedManifest = buildCuratedManifest({
        runId,
        url: "https://example.com",
        c1,
        c2,
        sourceManifestPath: curatedManifestPath,
    });
    await writeText(curatedManifestPath, JSON.stringify(curatedManifest, null, 2));
    const styleguideOutput = await (0, styleguide_1.runStyleguideStage)({
        runId,
        url: "https://example.com",
        curatedManifestPath,
        curatedManifest,
        signal: new AbortController().signal,
        runClaudeQuery: async () => buildValidMarkdown(),
    });
    const showcaseOutput = await (0, styleguide_1.runShowcaseStage)({
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
    strict_1.default.equal(await fileExists((0, node_path_1.join)(runDir, "styleguide", "showcase.prompt_input.json")), true);
    strict_1.default.equal(await fileExists((0, node_path_1.join)(runDir, "styleguide", "showcase.response.raw.txt")), true);
    strict_1.default.equal(await fileExists((0, node_path_1.join)(runDir, "styleguide", "showcase.validation.json")), true);
    strict_1.default.equal(await fileExists((0, node_path_1.join)(runDir, "styleguide", "showcase.html")), true);
    strict_1.default.equal(showcaseOutput.result.showcase.available, true);
    strict_1.default.equal(showcaseOutput.result.warning, undefined);
    await (0, promises_1.rm)(runDir, { recursive: true, force: true });
});
(0, node_test_1.default)("runStyleguideStage retries once when first draft quality is too low", async () => {
    const runId = makeRunId();
    const runDir = (0, artifacts_1.getStyleMdRunDir)(runId);
    await (0, promises_1.mkdir)((0, node_path_1.join)(runDir, "components"), { recursive: true });
    await writeText((0, node_path_1.join)(runDir, "full_screenshot.png"), "png");
    const c1 = await createComponentFixture(runId, "c1", 0);
    const c2 = await createComponentFixture(runId, "c2", 260);
    const curatedManifestPath = (0, node_path_1.join)(runDir, "components", "components_manifest.curated.json");
    const curatedManifest = buildCuratedManifest({
        runId,
        url: "https://example.com",
        c1,
        c2,
        sourceManifestPath: curatedManifestPath,
    });
    await writeText(curatedManifestPath, JSON.stringify(curatedManifest, null, 2));
    let calls = 0;
    const output = await (0, styleguide_1.runStyleguideStage)({
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
    strict_1.default.equal(calls, 2);
    strict_1.default.equal(await fileExists(output.result.styleMdPath), true);
    strict_1.default.equal(await fileExists((0, node_path_1.join)(runDir, "styleguide", "synthesis.pass2.raw.txt")), true);
    await (0, promises_1.rm)(runDir, { recursive: true, force: true });
});
(0, node_test_1.default)("runStyleguideStage failure persists trace artifacts and does not create fallback style.md", async () => {
    const runId = makeRunId();
    const runDir = (0, artifacts_1.getStyleMdRunDir)(runId);
    await (0, promises_1.mkdir)((0, node_path_1.join)(runDir, "components"), { recursive: true });
    await writeText((0, node_path_1.join)(runDir, "full_screenshot.png"), "png");
    const c1 = await createComponentFixture(runId, "c1", 0);
    const c2 = await createComponentFixture(runId, "c2", 260);
    const curatedManifestPath = (0, node_path_1.join)(runDir, "components", "components_manifest.curated.json");
    const curatedManifest = buildCuratedManifest({
        runId,
        url: "https://example.com",
        c1,
        c2,
        sourceManifestPath: curatedManifestPath,
    });
    await writeText(curatedManifestPath, JSON.stringify(curatedManifest, null, 2));
    await strict_1.default.rejects(async () => {
        await (0, styleguide_1.runStyleguideStage)({
            runId,
            url: "https://example.com",
            curatedManifestPath,
            curatedManifest,
            signal: new AbortController().signal,
            runClaudeQuery: async () => "too short",
        });
    }, (error) => error instanceof styleguide_1.StyleguideStageError);
    strict_1.default.equal(await fileExists((0, node_path_1.join)(runDir, "styleguide", "prompt_input.json")), true);
    strict_1.default.equal(await fileExists((0, node_path_1.join)(runDir, "styleguide", "evidence.agent.json")), true);
    strict_1.default.equal(await fileExists((0, node_path_1.join)(runDir, "styleguide", "response.raw.txt")), true);
    strict_1.default.equal(await fileExists((0, node_path_1.join)(runDir, "styleguide", "validation.json")), true);
    strict_1.default.equal(await fileExists((0, node_path_1.join)(runDir, "style.md")), false);
    await (0, promises_1.rm)(runDir, { recursive: true, force: true });
});
(0, node_test_1.default)("runShowcaseStage keeps style.md but skips showcase when showcase HTML is invalid", async () => {
    const runId = makeRunId();
    const runDir = (0, artifacts_1.getStyleMdRunDir)(runId);
    await (0, promises_1.mkdir)((0, node_path_1.join)(runDir, "components"), { recursive: true });
    await writeText((0, node_path_1.join)(runDir, "full_screenshot.png"), "png");
    const c1 = await createComponentFixture(runId, "c1", 0);
    const c2 = await createComponentFixture(runId, "c2", 260);
    const curatedManifestPath = (0, node_path_1.join)(runDir, "components", "components_manifest.curated.json");
    const curatedManifest = buildCuratedManifest({
        runId,
        url: "https://example.com",
        c1,
        c2,
        sourceManifestPath: curatedManifestPath,
    });
    await writeText(curatedManifestPath, JSON.stringify(curatedManifest, null, 2));
    const styleguideOutput = await (0, styleguide_1.runStyleguideStage)({
        runId,
        url: "https://example.com",
        curatedManifestPath,
        curatedManifest,
        signal: new AbortController().signal,
        runClaudeQuery: async () => buildValidMarkdown(),
    });
    const output = await (0, styleguide_1.runShowcaseStage)({
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
        runClaudeQuery: async () => ("<html><body><script>alert('x')</script><img src=\"https://example.com/a.png\" /></body></html>"),
    });
    strict_1.default.equal(await fileExists((0, node_path_1.join)(runDir, "style.md")), true);
    strict_1.default.equal(await fileExists((0, node_path_1.join)(runDir, "styleguide", "showcase.response.raw.txt")), true);
    strict_1.default.equal(await fileExists((0, node_path_1.join)(runDir, "styleguide", "showcase.validation.json")), true);
    strict_1.default.equal(await fileExists((0, node_path_1.join)(runDir, "styleguide", "showcase.html")), false);
    strict_1.default.equal(output.result.showcase.available, false);
    strict_1.default.match(output.result.warning ?? "", /Showcase generation failed/i);
    await (0, promises_1.rm)(runDir, { recursive: true, force: true });
});
(0, node_test_1.default)("runStyleguideStage resolves required typography families via localized font aliases", async () => {
    const runId = makeRunId();
    const runDir = (0, artifacts_1.getStyleMdRunDir)(runId);
    await (0, promises_1.mkdir)((0, node_path_1.join)(runDir, "components"), { recursive: true });
    await writeText((0, node_path_1.join)(runDir, "full_screenshot.png"), "png");
    const c1 = await createComponentFixture(runId, "c1", 0);
    const c2 = await createComponentFixture(runId, "c2", 260);
    await writeText(c1.agentStylesPath, JSON.stringify({ display: "block", "font-family": "\"Vivey 22 Positive\"" }, null, 2));
    await writeText(c1.agentStyleTreePath, JSON.stringify([
        {
            nodePath: "section",
            tagName: "section",
            textSample: "Hero",
            rect: { top: 0, left: 0, width: 1200, height: 240, bottom: 240 },
            styles: { "font-family": "\"Vivey 22 Positive\"" },
        },
    ], null, 2));
    await writeText(c2.agentStylesPath, JSON.stringify({ display: "block", "font-family": "\"FHA Condensed French NC\"" }, null, 2));
    await writeText(c2.agentStyleTreePath, JSON.stringify([
        {
            nodePath: "section",
            tagName: "section",
            textSample: "Caption",
            rect: { top: 260, left: 0, width: 1200, height: 240, bottom: 500 },
            styles: { "font-family": "\"FHA Condensed French NC\"" },
        },
    ], null, 2));
    const curatedManifestPath = (0, node_path_1.join)(runDir, "components", "components_manifest.curated.json");
    const curatedManifest = buildCuratedManifest({
        runId,
        url: "https://example.com",
        c1,
        c2,
        sourceManifestPath: curatedManifestPath,
    });
    await writeText(curatedManifestPath, JSON.stringify(curatedManifest, null, 2));
    const localVeveyPath = (0, node_path_1.join)(runDir, "page_styles", "fonts", "vevey22_alias.woff2");
    const localFhaPath = (0, node_path_1.join)(runDir, "page_styles", "fonts", "fha_alias.woff2");
    await writeText(localVeveyPath, "font");
    await writeText(localFhaPath, "font");
    const fontsManifestPath = (0, node_path_1.join)(runDir, "page_styles", "fonts.manifest.json");
    await writeText(fontsManifestPath, JSON.stringify({
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
        local_css_path: (0, node_path_1.join)(runDir, "page_styles", "fonts.local.css"),
        families: [
            { family: "Vevey22", localized_sources: 1 },
            { family: "FHACondensed", localized_sources: 1 },
        ],
    }, null, 2));
    const fontsLocalCssPath = (0, node_path_1.join)(runDir, "page_styles", "fonts.local.css");
    await writeText(fontsLocalCssPath, [
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
    ].join("\n"));
    const styleguideOutput = await (0, styleguide_1.runStyleguideStage)({
        runId,
        url: "https://example.com",
        curatedManifestPath,
        curatedManifest,
        signal: new AbortController().signal,
        runClaudeQuery: async () => buildTypographyMarkdown(),
    });
    const output = await (0, styleguide_1.runShowcaseStage)({
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
    strict_1.default.equal(output.result.showcase.available, true);
    strict_1.default.equal(output.result.warning, undefined);
    strict_1.default.equal(await fileExists((0, node_path_1.join)(runDir, "styleguide", "showcase.html")), true);
    await (0, promises_1.rm)(runDir, { recursive: true, force: true });
});
(0, node_test_1.default)("runStyleguideStage forwards runtime provider/model/env to query runner", async () => {
    const runId = makeRunId();
    const runDir = (0, artifacts_1.getStyleMdRunDir)(runId);
    await (0, promises_1.mkdir)((0, node_path_1.join)(runDir, "components"), { recursive: true });
    await writeText((0, node_path_1.join)(runDir, "full_screenshot.png"), "png");
    const c1 = await createComponentFixture(runId, "c1", 0);
    const c2 = await createComponentFixture(runId, "c2", 260);
    const curatedManifestPath = (0, node_path_1.join)(runDir, "components", "components_manifest.curated.json");
    const curatedManifest = buildCuratedManifest({
        runId,
        url: "https://example.com",
        c1,
        c2,
        sourceManifestPath: curatedManifestPath,
    });
    await writeText(curatedManifestPath, JSON.stringify(curatedManifest, null, 2));
    let capturedRuntime;
    const output = await (0, styleguide_1.runStyleguideStage)({
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
    strict_1.default.equal(output.result.query.failed, false);
    strict_1.default.equal(capturedRuntime?.provider, "kimi");
    strict_1.default.equal(capturedRuntime?.model, "kimi-k2.5");
    strict_1.default.equal(capturedRuntime?.queryModel, "kimi-k2.5");
    strict_1.default.equal(capturedRuntime?.env.ANTHROPIC_BASE_URL, "https://api.moonshot.ai/anthropic");
    strict_1.default.equal(capturedRuntime?.env.ANTHROPIC_AUTH_TOKEN, "sk-test");
    await (0, promises_1.rm)(runDir, { recursive: true, force: true });
});
(0, node_test_1.default)("runShowcaseStage forwards runtime provider/model/env to query runner", async () => {
    const runId = makeRunId();
    const runDir = (0, artifacts_1.getStyleMdRunDir)(runId);
    await (0, promises_1.mkdir)((0, node_path_1.join)(runDir, "components"), { recursive: true });
    await writeText((0, node_path_1.join)(runDir, "full_screenshot.png"), "png");
    const c1 = await createComponentFixture(runId, "c1", 0);
    const c2 = await createComponentFixture(runId, "c2", 260);
    const curatedManifestPath = (0, node_path_1.join)(runDir, "components", "components_manifest.curated.json");
    const curatedManifest = buildCuratedManifest({
        runId,
        url: "https://example.com",
        c1,
        c2,
        sourceManifestPath: curatedManifestPath,
    });
    await writeText(curatedManifestPath, JSON.stringify(curatedManifest, null, 2));
    const styleguideOutput = await (0, styleguide_1.runStyleguideStage)({
        runId,
        url: "https://example.com",
        curatedManifestPath,
        curatedManifest,
        signal: new AbortController().signal,
        runClaudeQuery: async () => buildValidMarkdown(),
    });
    let capturedRuntime;
    const output = await (0, styleguide_1.runShowcaseStage)({
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
    strict_1.default.equal(output.result.showcase.available, true);
    strict_1.default.equal(capturedRuntime?.provider, "kimi");
    strict_1.default.equal(capturedRuntime?.model, "kimi-k2.5");
    strict_1.default.equal(capturedRuntime?.queryModel, "kimi-k2.5");
    strict_1.default.equal(capturedRuntime?.env.ANTHROPIC_BASE_URL, "https://api.moonshot.ai/anthropic");
    strict_1.default.equal(capturedRuntime?.env.ANTHROPIC_AUTH_TOKEN, "sk-test");
    await (0, promises_1.rm)(runDir, { recursive: true, force: true });
});
