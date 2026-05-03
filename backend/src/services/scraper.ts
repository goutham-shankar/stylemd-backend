import * as cheerio from "cheerio";
import { normalize, type NormalizedData } from "./normalize";

async function fetchWithTimeout(url: string, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: "follow" });
    clearTimeout(id);
    return res;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

async function scrapeOnce(url: string): Promise<NormalizedData> {
  console.log(`[SCRAPER] Starting to scrape: ${url}`);
  
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  const html = await res.text();
  console.log(`[SCRAPER] Fetched HTML, length: ${html.length}`);
  
  const $ = cheerio.load(html);
  
  const title = $("head > title").first().text().trim() || $('meta[property="og:title"]').attr("content") || null;
  console.log(`[EXTRACTOR] Extracted title: ${title}`);
  
  const description = $('meta[name="description"]').attr("content") || $('meta[property="og:description"]').attr("content") || null;
  console.log(`[EXTRACTOR] Extracted description: ${description?.slice(0, 100)}...`);
  
  const h1 = $("h1").first().text().trim() || null;
  console.log(`[EXTRACTOR] Extracted h1: ${h1}`);
  
  const canonical = $('link[rel="canonical"]').attr("href") || null;
  console.log(`[EXTRACTOR] Extracted canonical: ${canonical}`);
  
  const images: string[] = [];
  $("img").each((_i, el) => { const src = $(el).attr("src"); if (src) images.push(src); });
  const ogImage = $('meta[property="og:image"]').attr("content");
  if (ogImage) images.push(ogImage);
  const twitterImage = $('meta[name="twitter:image"]').attr("content");
  if (twitterImage) images.push(twitterImage);
  console.log(`[EXTRACTOR] Found ${images.length} images:`, images);
  
  const contentText = $("body").text().replace(/\s+/g, " ").trim().slice(0, 20000);
  console.log(`[SCRAPER] Extracted contentText, length: ${contentText.length}`);
  
  const result = normalize({ url, title, description, h1, canonical, images, contentText, rawHtml: html });
  console.log(`[SCRAPER] Normalized data, images count: ${result.images.length}`);
  
  return result;
}

export async function scrape(url: string, retries = 2, delayMs = 1000): Promise<NormalizedData | null> {
  let attempt = 0;
  while (attempt <= retries) {
    try { return await scrapeOnce(url); } catch (err) {
      console.error(`[ERROR] Failed to extract images:`, err);
      attempt += 1;
      if (attempt > retries) { console.error("[SCRAPER] Failed after retries:", err); return null; }
      console.log(`[SCRAPER] Retry ${attempt}/${retries} after ${delayMs * attempt}ms...`);
      await new Promise((r) => setTimeout(r, delayMs * attempt));
    }
  }
  return null;
}