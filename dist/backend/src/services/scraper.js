"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.scrape = scrape;
const cheerio = __importStar(require("cheerio"));
const playwright_1 = require("playwright");
const helpers_1 = require("../../../lib/stylemd-artifacts/helpers");
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function toBase64(url) {
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (!res.ok)
            return null;
        const buffer = await res.arrayBuffer();
        const mime = res.headers.get("content-type") || "image/png";
        // Skip large images (>1MB) as per Step 4 RULES
        if (buffer.byteLength > 1024 * 1024) {
            console.warn(`[BRAND ASSETS] Image too large: ${url} (${buffer.byteLength} bytes)`);
            return null;
        }
        return `data:${mime};base64,${Buffer.from(buffer).toString("base64")}`;
    }
    catch (e) {
        console.warn(`[BRAND ASSETS] toBase64 failed for ${url}:`, e);
        return null;
    }
}
// ---------------------------------------------------------------------------
// Scrape a single URL using Playwright (screenshot) + Cheerio (DOM extraction).
// image/jpeg ONLY. Base64 ONLY.
// ---------------------------------------------------------------------------
async function scrapeOnce(url) {
    console.log(`[SCRAPE] scraping url=${url}`);
    let browser = null;
    let screenshotBase64 = null;
    try {
        browser = await playwright_1.chromium.launch((0, helpers_1.getPlaywrightLaunchOptions)());
        const page = await browser.newPage();
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
        // Take JPEG screenshot entirely in-memory — no file paths, no disk writes
        const buffer = await page.screenshot({ type: "jpeg", quality: 80 });
        // VALIDATE buffer
        if (!buffer || buffer.length === 0) {
            throw new Error(`Failed to capture screenshot for ${url}: empty buffer`);
        }
        screenshotBase64 = `data:image/jpeg;base64,${buffer.toString("base64")}`;
        console.log(`[SCRAPE] screenshot captured, base64 length=${screenshotBase64.length}`);
        const rawHtml = await page.content();
        const baseUrl = page.url(); // Use the actual page URL after redirects
        await browser.close();
        browser = null;
        const $ = cheerio.load(rawHtml);
        // 🔴 STEP 1: EXTRACT METADATA ASSETS
        const faviconRaw = $("link[rel='icon']").attr("href") || $("link[rel='shortcut icon']").attr("href");
        const appleIconRaw = $("link[rel='apple-touch-icon']").attr("href");
        const ogImageRaw = $("meta[property='og:image']").attr("content");
        const resolveUrl = (src) => {
            if (!src)
                return null;
            try {
                return new URL(src, baseUrl).href;
            }
            catch {
                return null;
            }
        };
        const faviconUrl = resolveUrl(faviconRaw);
        const appleIconUrl = resolveUrl(appleIconRaw);
        const ogImageUrl = resolveUrl(ogImageRaw);
        // 🔴 STEP 2: EXTRACT LOGO FROM DOM (CANDIDATES)
        const logoCandidates = [];
        $("img").each((_, el) => {
            const src = $(el).attr("src");
            if (!src)
                return;
            const alt = ($(el).attr("alt") || "").toLowerCase();
            const cls = ($(el).attr("class") || "").toLowerCase();
            const id = ($(el).attr("id") || "").toLowerCase();
            let score = 0;
            // Scoring signals
            if (alt.includes("logo") || cls.includes("logo") || id.includes("logo"))
                score += 3;
            if ($(el).closest("header, nav, [id*='header'], [class*='header']").length)
                score += 2;
            if (src.includes("logo") || src.includes("brand"))
                score += 2;
            const absoluteUrl = resolveUrl(src);
            if (absoluteUrl) {
                logoCandidates.push({ url: absoluteUrl, score });
            }
        });
        const bestLogoUrl = logoCandidates.sort((a, b) => b.score - a.score)[0]?.url;
        // 🔴 STEP 3: CONVERT TO BASE64 (NON-BLOCKING)
        const brandAssets = {
            logo: null,
            favicon: null,
            appleIcon: appleIconUrl,
            ogImage: ogImageUrl
        };
        try {
            // We only convert logo and favicon to base64 for now to keep doc size low
            if (bestLogoUrl)
                brandAssets.logo = await toBase64(bestLogoUrl);
            if (faviconUrl)
                brandAssets.favicon = await toBase64(faviconUrl);
        }
        catch (e) {
            console.warn("[BRAND ASSETS] Base64 conversion failed:", e);
        }
        const title = $("head > title").first().text().trim() ||
            $('meta[property="og:title"]').attr("content") ||
            null;
        const description = $('meta[name="description"]').attr("content") ||
            $('meta[property="og:description"]').attr("content") ||
            null;
        const h1 = $("h1").first().text().trim() || null;
        const canonical = $('link[rel="canonical"]').attr("href") || null;
        // images array MUST be Base64 ONLY.
        const images = screenshotBase64 ? [screenshotBase64] : [];
        const contentText = $("body")
            .text()
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 20000);
        console.log(`[SCRAPE] extracted title="${title?.slice(0, 60)}" images=${images.length}`);
        return {
            url,
            title: title ? String(title).trim() : null,
            description: description ? String(description).trim() : null,
            h1: h1 ? String(h1).trim() : null,
            canonical: canonical ? String(canonical).trim() : null,
            images,
            contentText: contentText ? String(contentText).trim() : null,
            rawHtml: rawHtml ? String(rawHtml).slice(0, 50000) : null, // Truncate to 50KB
            screenshotBase64,
            brandAssets
        };
    }
    finally {
        if (browser) {
            await browser.close().catch(() => undefined);
        }
    }
}
// ---------------------------------------------------------------------------
// Public export — retries on transient failures.
// Returns null only after all retries are exhausted.
// ---------------------------------------------------------------------------
async function scrape(url, retries = 2, delayMs = 1000) {
    let attempt = 0;
    while (attempt <= retries) {
        try {
            return await scrapeOnce(url);
        }
        catch (err) {
            attempt++;
            if (attempt > retries) {
                console.error(`[SCRAPE] error url=${url}`, err instanceof Error ? err.message : String(err));
                return null;
            }
            console.warn(`[SCRAPE] retry ${attempt}/${retries} url=${url} delay=${delayMs * attempt}ms`);
            await new Promise((r) => setTimeout(r, delayMs * attempt));
        }
    }
    return null;
}
