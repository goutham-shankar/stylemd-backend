import * as cheerio from "cheerio";
import { chromium } from "playwright";
import { NormalizedData } from "./normalize";
import { getPlaywrightLaunchOptions } from "@/lib/stylemd-artifacts/helpers";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function toBase64(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    
    const buffer = await res.arrayBuffer();
    const mime = res.headers.get("content-type") || "image/png";
    
    // Skip large images (>1MB) as per Step 4 RULES
    if (buffer.byteLength > 1024 * 1024) {
      console.warn(`[BRAND ASSETS] Image too large: ${url} (${buffer.byteLength} bytes)`);
      return null;
    }

    return `data:${mime};base64,${Buffer.from(buffer).toString("base64")}`;
  } catch (e) {
    console.warn(`[BRAND ASSETS] toBase64 failed for ${url}:`, e);
    return null;
  }
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
    browser = await chromium.launch(getPlaywrightLaunchOptions());
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1440, height: 900 });

    // domcontentloaded fires fast; networkidle can stall 30s on analytics/WS sites.
    // We compensate with our own settle logic below.
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    // Wait for the load event (images/fonts start), but don't block on networkidle
    await page.waitForLoadState("load", { timeout: 15_000 }).catch(() => undefined);

    // Dismiss cookie / consent / newsletter popups.
    // All selectors checked in parallel — total cost ≈ one 150ms round-trip, not 19.
    const dismissSelectors = [
      '#onetrust-accept-btn-handler',
      '#onetrust-reject-all-handler',
      '.ot-sdk-btn.ot-reject-all',
      '#truste-consent-button',
      '#CybotCookiebotDialogBodyButtonAccept',
      '#CybotCookiebotDialogBodyLevelButtonAccept',
      '[data-testid="cookie-policy-dialog-accept-button"]',
      '[class*="cookie"] button:text-matches("agree|accept|allow|got it|ok", "i")',
      '[class*="consent"] button:text-matches("agree|accept|allow|got it|ok", "i")',
      '[class*="gdpr"] button:text-matches("agree|accept|allow|got it|ok", "i")',
      '[id*="cookie"] button:text-matches("agree|accept|allow|got it|ok", "i")',
      '[id*="consent"] button:text-matches("agree|accept|allow|got it|ok", "i")',
      '[class*="cookie"] button:text-matches("reject|decline|refuse|close|no thanks", "i")',
      '[class*="consent"] button:text-matches("reject|decline|refuse|close|no thanks", "i")',
      '[role="dialog"] button[aria-label*="close" i]',
      '[class*="modal"] button[aria-label*="close" i]',
      '[class*="popup"] button[aria-label*="close" i]',
    ];

    const runDismiss = async () => {
      // Check all selectors in parallel — each resolves independently
      await Promise.allSettled(
        dismissSelectors.map(async (sel) => {
          try {
            const el = page.locator(sel).first();
            if (await el.isVisible({ timeout: 150 })) {
              await el.click({ timeout: 800 });
              console.log(`[SCRAPE] dismissed overlay via: ${sel}`);
            }
          } catch { /* not present — skip */ }
        })
      );
    };

    // First pass — banners present at load time
    await runDismiss();

    // Wait for delayed popups (Intercom, Drift usually inject within 1.5s)
    await page.waitForTimeout(1500);

    // Second pass — anything that appeared while waiting
    await runDismiss();

    // Wait for all web fonts to finish loading
    await page.evaluate(() => document.fonts.ready).catch(() => undefined);

    // Wait until every visible <img> is fully decoded.
    // Lazy images off-screen never fire load/error, so race against a 5s ceiling.
    await Promise.race([
      page.evaluate(() => {
        const imgs = Array.from(document.images).filter((img) => {
          const r = img.getBoundingClientRect();
          return r.top < window.innerHeight && r.bottom > 0; // in viewport only
        });
        return Promise.all(
          imgs.map((img) =>
            img.complete
              ? Promise.resolve()
              : new Promise<void>((resolve) => {
                  img.addEventListener("load", () => resolve(), { once: true });
                  img.addEventListener("error", () => resolve(), { once: true });
                })
          )
        );
      }).catch(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, 5000)),
    ]);

    // Take JPEG screenshot entirely in-memory — no file paths, no disk writes
    const buffer = await page.screenshot({ type: "jpeg", quality: 80, fullPage: true });

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

    const resolveUrl = (src: string | undefined) => {
      if (!src) return null;
      try {
        return new URL(src, baseUrl).href;
      } catch {
        return null;
      }
    };

    const faviconUrl = resolveUrl(faviconRaw);
    const appleIconUrl = resolveUrl(appleIconRaw);
    const ogImageUrl = resolveUrl(ogImageRaw);

    // 🔴 STEP 2: EXTRACT LOGO FROM DOM (CANDIDATES)
    const logoCandidates: { url: string; score: number }[] = [];
    
    $("img").each((_, el) => {
      const src = $(el).attr("src");
      if (!src) return;

      const alt = ($(el).attr("alt") || "").toLowerCase();
      const cls = ($(el).attr("class") || "").toLowerCase();
      const id = ($(el).attr("id") || "").toLowerCase();

      let score = 0;

      // Scoring signals
      if (alt.includes("logo") || cls.includes("logo") || id.includes("logo")) score += 3;
      if ($(el).closest("header, nav, [id*='header'], [class*='header']").length) score += 2;
      if (src.includes("logo") || src.includes("brand")) score += 2;

      const absoluteUrl = resolveUrl(src);
      if (absoluteUrl) {
        logoCandidates.push({ url: absoluteUrl, score });
      }
    });

    const bestLogoUrl = logoCandidates.sort((a, b) => b.score - a.score)[0]?.url;

    // 🔴 STEP 3: CONVERT TO BASE64 (NON-BLOCKING)
    const brandAssets = {
      logo: null as string | null,
      favicon: null as string | null,
      appleIcon: appleIconUrl,
      ogImage: ogImageUrl
    };

    try {
      // We only convert logo and favicon to base64 for now to keep doc size low
      if (bestLogoUrl) brandAssets.logo = await toBase64(bestLogoUrl);
      if (faviconUrl) brandAssets.favicon = await toBase64(faviconUrl);
    } catch (e) {
      console.warn("[BRAND ASSETS] Base64 conversion failed:", e);
    }

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

    // images array MUST be Base64 ONLY.
    const images: string[] = screenshotBase64 ? [screenshotBase64] : [];

    const contentText = $("body")
      .text()
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 20_000);

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