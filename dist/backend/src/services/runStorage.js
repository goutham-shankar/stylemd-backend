"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.urlToSlug = urlToSlug;
exports.getRunFilePath = getRunFilePath;
exports.getRunUrl = getRunUrl;
exports.saveRunHtml = saveRunHtml;
exports.saveRunDesignMd = saveRunDesignMd;
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
// Converts a URL into a filesystem-safe slug.
// Root URL → just hostname:           "https://apple.com/"               → "apple.com"
// Sub-path  → hostname_path:           "https://apple.com/iphone"         → "apple.com_iphone"
// Deep path →                          "https://getdesign.md/x/nintendo"  → "getdesign.md_x_nintendo"
function urlToSlug(url) {
    try {
        const { hostname, pathname } = new URL(url);
        const pathSlug = pathname.replace(/^\/+|\/+$/g, "").replace(/\//g, "_");
        const base = pathSlug ? `${hostname}_${pathSlug}` : hostname;
        return base.replace(/[^a-z0-9_\-\.]/gi, "_").slice(0, 120);
    }
    catch {
        return url.replace(/[^a-z0-9_\-]/gi, "_").slice(0, 120);
    }
}
function runsDir() {
    return (0, node_path_1.join)(process.cwd(), "runs");
}
function getRunFilePath(url) {
    return (0, node_path_1.join)(runsDir(), urlToSlug(url), "preview.html");
}
function getRunUrl(url) {
    const slug = urlToSlug(url);
    return `/runs/${slug}/preview.html`;
}
async function saveRunHtml(url, html) {
    const slug = urlToSlug(url);
    const dir = (0, node_path_1.join)(runsDir(), slug);
    await (0, promises_1.mkdir)(dir, { recursive: true });
    const filePath = (0, node_path_1.join)(dir, "preview.html");
    await (0, promises_1.writeFile)(filePath, html, "utf-8");
    return { filePath, serveUrl: `/runs/${slug}/preview.html` };
}
async function saveRunDesignMd(url, md) {
    const slug = urlToSlug(url);
    const dir = (0, node_path_1.join)(runsDir(), slug);
    await (0, promises_1.mkdir)(dir, { recursive: true });
    const filePath = (0, node_path_1.join)(dir, "design.md");
    await (0, promises_1.writeFile)(filePath, md, "utf-8");
    return { filePath, serveUrl: `/runs/${slug}/design.md` };
}
