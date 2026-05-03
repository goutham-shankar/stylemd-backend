"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.downloadStyleguideV2 = downloadStyleguideV2;
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const artifacts_1 = require("@/lib/stylemd-artifacts/artifacts");
function rewriteFontUrlsToAbsolute(html, runId) {
    const fontUrlRegex = /url\(\s*(["']?)([^"')]*\.(?:woff2?|ttf|otf|eot))\1\s*\)/gi;
    return html.replace(fontUrlRegex, (_match, quote, fontPath) => {
        if (!fontPath)
            return _match;
        const cleanPath = fontPath.replace(/^\.\.\/+/, "");
        const absoluteUrl = `/styleguide-files/${encodeURIComponent(runId)}/${cleanPath}`;
        return `url(${quote || '"'}${absoluteUrl}${quote || '"'})`;
    });
}
async function downloadStyleguideV2(req, res) {
    try {
        const runId = req.query["runId"];
        if (!runId || typeof runId !== "string") {
            res.status(400).json({ ok: false, error: "runId parameter is required." });
            return;
        }
        const runDir = (0, artifacts_1.getStyleMdRunDir)(runId);
        const showcasePath = (0, node_path_1.join)(runDir, "styleguide", "showcase.html");
        const htmlBuffer = await (0, promises_1.readFile)(showcasePath);
        let htmlContent = htmlBuffer.toString("utf-8");
        htmlContent = rewriteFontUrlsToAbsolute(htmlContent, runId);
        const timestamp = new Date().toISOString();
        const attribution = `<!-- Generated with KIMI AI StyleMD at ${timestamp} -->`;
        const footer = `<!-- Styleguide generated with KIMI AI -->`;
        htmlContent = htmlContent.replace(/(<html[^>]*>)/i, `$1\n${attribution}`).replace(/(<\/body>)/i, `  ${footer}\n$1`);
        res.setHeader("Content-Type", "text/html; charset=utf-8")
            .setHeader("Content-Disposition", `attachment; filename="styleguide-${runId}.html"`)
            .setHeader("Cache-Control", "no-store")
            .send(htmlContent);
    }
    catch (err) {
        if (err.code === "ENOENT") {
            res.status(404).json({ ok: false, error: "Styleguide HTML not found for this run." });
            return;
        }
        res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
}
