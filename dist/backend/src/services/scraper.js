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
const normalize_1 = require("./normalize");
async function fetchWithTimeout(url, timeoutMs = 15000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { signal: controller.signal, redirect: "follow" });
        clearTimeout(id);
        return res;
    }
    catch (err) {
        clearTimeout(id);
        throw err;
    }
}
async function scrapeOnce(url) {
    console.log(`[SCRAPER] Starting to scrape: ${url}`);
    const res = await fetchWithTimeout(url);
    if (!res.ok)
        throw new Error(`Fetch failed: ${res.status}`);
    const html = await res.text();
    console.log(`[SCRAPER] Fetched HTML, length: ${html.length}`);
    const $ = cheerio.load(html);
    const title = $("head > title").first().text().trim() || $('meta[property="og:title"]').attr("content") || null;
    console.log(`[SCRAPER] Extracted title: ${title}`);
    const description = $('meta[name="description"]').attr("content") || $('meta[property="og:description"]').attr("content") || null;
    console.log(`[SCRAPER] Extracted description: ${description?.slice(0, 100)}...`);
    const h1 = $("h1").first().text().trim() || null;
    console.log(`[SCRAPER] Extracted h1: ${h1}`);
    const canonical = $('link[rel="canonical"]').attr("href") || null;
    console.log(`[SCRAPER] Extracted canonical: ${canonical}`);
    const images = [];
    $("img").each((_i, el) => { const src = $(el).attr("src"); if (src)
        images.push(src); });
    const ogImage = $('meta[property="og:image"]').attr("content");
    if (ogImage)
        images.push(ogImage);
    const twitterImage = $('meta[name="twitter:image"]').attr("content");
    if (twitterImage)
        images.push(twitterImage);
    console.log(`[SCRAPER] Found ${images.length} images:`, images.slice(0, 5));
    const contentText = $("body").text().replace(/\s+/g, " ").trim().slice(0, 20000);
    console.log(`[SCRAPER] Extracted contentText, length: ${contentText.length}`);
    const result = (0, normalize_1.normalize)({ url, title, description, h1, canonical, images, contentText, rawHtml: html });
    console.log(`[SCRAPER] Normalized data, images count: ${result.images.length}`);
    return result;
}
async function scrape(url, retries = 2, delayMs = 1000) {
    let attempt = 0;
    while (attempt <= retries) {
        try {
            return await scrapeOnce(url);
        }
        catch (err) {
            attempt += 1;
            if (attempt > retries) {
                console.error("[SCRAPER] Failed after retries:", err);
                return null;
            }
            console.log(`[SCRAPER] Retry ${attempt}/${retries} after ${delayMs * attempt}ms...`);
            await new Promise((r) => setTimeout(r, delayMs * attempt));
        }
    }
    return null;
}
