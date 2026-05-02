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
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);
  const title = $("head > title").first().text().trim() || null;
  const description = $('meta[name="description"]').attr("content") || $('meta[property="og:description"]').attr("content") || null;
  const h1 = $("h1").first().text().trim() || null;
  const canonical = $('link[rel="canonical"]').attr("href") || null;
  const images: string[] = [];
  $("img").each((_i, el) => { const src = $(el).attr("src"); if (src) images.push(src); });
  const contentText = $("body").text().replace(/\s+/g, " ").trim().slice(0, 20000);
  return normalize({ url, title, description, h1, canonical, images, contentText, rawHtml: html });
}

export async function scrape(url: string, retries = 2, delayMs = 1000): Promise<NormalizedData | null> {
  let attempt = 0;
  while (attempt <= retries) {
    try { return await scrapeOnce(url); } catch (err) {
      attempt += 1;
      if (attempt > retries) { console.error("[scraper] failed", err); return null; }
      await new Promise((r) => setTimeout(r, delayMs * attempt));
    }
  }
  return null;
}
