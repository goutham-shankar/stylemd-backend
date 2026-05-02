import * as cheerio from 'cheerio';
import normalize from '../utils/normalize';

async function fetchWithTimeout(url: string, timeout = 15000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    clearTimeout(id);
    return res;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

async function scrapeOnce(url: string) {
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  const title = $('head > title').first().text().trim() || null;
  const description = $('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || null;
  const h1 = $('h1').first().text().trim() || null;
  const canonical = $('link[rel="canonical"]').attr('href') || null;
  const images: string[] = [];
  $('img').each((i, el) => {
    const src = $(el).attr('src');
    if (src) images.push(src);
  });

  const text = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 20000);

  return normalize({ url, title, description, h1, canonical, images, contentText: text, rawHtml: html });
}

async function scrape(url: string, retries = 2, delayMs = 1000) {
  let attempt = 0;
  while (attempt <= retries) {
    try {
      return await scrapeOnce(url);
    } catch (err) {
      attempt += 1;
      if (attempt > retries) {
        console.error('scrape failed', { url, err: (err as Error).message });
        return null;
      }
      await new Promise(r => setTimeout(r, delayMs * attempt));
    }
  }
  return null;
}

export default { scrape };