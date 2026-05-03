import * as cheerio from "cheerio";
import { chromium } from "playwright";

export interface NormalizedData {
  url: string;
  title: string | null;
  description: string | null;
  h1: string | null;
  canonical: string | null;
  images: string[];
  contentText: string | null;
  rawHtml: string | null;
}

// ---------------------------------------------------------------------------
// Scrape a single URL using Playwright (screenshot) + Cheerio (DOM extraction).
// image/jpeg ONLY. Base64 ONLY.
// ---------------------------------------------------------------------------

async function scrapeOnce(url: string): Promise<NormalizedData> {
  console.log(`[SCRAPE] scraping url=${url}`);

  let browser = null;
  let screenshotBase64: string | null = null;

  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });

    // Take JPEG screenshot entirely in-memory — no file paths, no disk writes
    const buffer = await page.screenshot({ type: "jpeg", quality: 80 });
    
    // VALIDATE buffer
    if (!buffer || buffer.length === 0) {
      throw new Error(`Failed to capture screenshot for ${url}: empty buffer`);
    }

    screenshotBase64 = `data:image/jpeg;base64,${buffer.toString("base64")}`;
    console.log(`[SCRAPE] screenshot captured, base64 length=${screenshotBase64.length}`);

    const rawHtml = await page.content();
    await browser.close();
    browser = null;

    const $ = cheerio.load(rawHtml);

    const title =
      $("head > title").first().text().trim() ||
      $('meta[property="og:title"]').attr("content") ||
      null;

    const description =
      $('meta[name="description"]').attr("content") ||
      $('meta[property="og:description"]').attr("content") ||
      null;

    const h1 = $("h1").first().text().trim() || null;

    const canonical = $('link[rel="canonical"]').attr("href") || null;

    // images array MUST be Base64 ONLY. Remove all raw URLs.
    const images: string[] = [screenshotBase64];

    const contentText = $("body")
      .text()
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 20_000);

    console.log(`[SCRAPE] extracted title="${title?.slice(0, 60)}" images=1`);

    return { 
      url, 
      title: title ? String(title).trim() : null, 
      description: description ? String(description).trim() : null, 
      h1: h1 ? String(h1).trim() : null, 
      canonical: canonical ? String(canonical).trim() : null, 
      images, 
      contentText: contentText ? String(contentText).trim() : null, 
      rawHtml: rawHtml ? String(rawHtml) : null 
    };
  } finally {
    if (browser) {
      await browser.close().catch(() => undefined);
    }
  }
}

// ---------------------------------------------------------------------------
// Public export — retries on transient failures.
// Returns null only after all retries are exhausted.
// ---------------------------------------------------------------------------
export async function scrape(url: string, retries = 2, delayMs = 1000): Promise<NormalizedData | null> {
  let attempt = 0;
  while (attempt <= retries) {
    try {
      return await scrapeOnce(url);
    } catch (err) {
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