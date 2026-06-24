import { chromium } from "playwright";
import sharp from "sharp";
import { uploadR2, r2KeyFor } from "@/lib/queue/r2";
import { safeWrite } from "@/lib/mongodb";
import { StyleMdRun } from "@/backend/src/models/StyleMdRun";
import { getPlaywrightLaunchOptions } from "@/lib/stylemd-artifacts/helpers";
import type { DesignResolver, ResolverContext, ResolveResult } from "./types";

const VOLT_FETCH_TIMEOUT_MS = 15_000;
const VOLT_BASE = "https://getdesign.md/design-md";

/**
 * Post-processes HTML fetched from VoltAgent before storing in R2:
 *  1. Removes the VoltAgent-branded footer (`.footer` block with footer-shell/footer-credit).
 *  2. Replaces the nav brand text with a getdesign.md link.
 *  3. Strips any leftover "awesome-design-md" text references.
 */
function sanitizeVoltHtml(html: string): string {
  let out = html;

  // ── 1. Remove the entire VoltAgent footer block ───────────────────────────
  // Matches <footer class="footer"> ... </footer> (the branded one)
  out = out.replace(/<footer\s[^>]*class="[^"]*\bfooter\b[^"]*"[^>]*>[\s\S]*?<\/footer>/gi, "");

  // ── 2. Replace nav brand with getmd.design link ────────────────────────────
  // Pattern A: <span class="nav-brand">anything</span>
  out = out.replace(
    /<span\s[^>]*class="[^"]*\bnav-brand\b[^"]*"[^>]*>[\s\S]*?<\/span>/gi,
    `<a href="https://getmd.design/" target="_blank" rel="noopener noreferrer" class="nav-brand-link" style="text-decoration:none;"><span class="nav-brand">getmd.design</span></a>`,
  );

  // Pattern B: plain text "awesome-design-md" anywhere else (footer text, titles, etc.)
  out = out.replace(/awesome-design-md/gi, "getmd.design");

  // ── 3. Fix page <title> if it references awesome-design-md ───────────────
  out = out.replace(
    /(<title>[^<]*?)awesome-design-md([^<]*?<\/title>)/gi,
    "$1getmd.design$2",
  );

  // ── 4. Remove GitHub links/buttons from the nav ───────────────────────────
  out = out.replace(/<a\s[^>]*href="[^"]*github\.com[^"]*"[^>]*>[\s\S]*?<\/a>/gi, "");

  return out;
}


function slugFromUrl(url: string): string {
  try {
    let host = new URL(url).hostname;
    if (host.startsWith("www.")) host = host.slice(4);
    return host.replace(/\.[^.]+$/, "");
  } catch {
    return "";
  }
}

function voltDesignMdUrl(slug: string): string {
  return `${VOLT_BASE}/${slug}/DESIGN.md`;
}

function voltPreviewUrl(slug: string): string {
  return `${VOLT_BASE}/${slug}/preview`;
}

async function voltHasDesign(slug: string): Promise<boolean> {
  try {
    const resp = await fetch(voltDesignMdUrl(slug), {
      method: "HEAD",
      signal: AbortSignal.timeout(VOLT_FETCH_TIMEOUT_MS),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

async function captureScreenshot(url: string): Promise<string | null> {
  let browser;
  try {
    browser = await chromium.launch(getPlaywrightLaunchOptions());
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(2000);

    const buffer = await page.screenshot({ type: "jpeg", quality: 60, fullPage: true });
    const compressed = await sharp(buffer)
      .resize({ width: 1000, withoutEnlargement: true })
      .jpeg({ quality: 60 })
      .toBuffer();

    return `data:image/jpeg;base64,${compressed.toString("base64")}`;
  } catch (err) {
    console.warn(`[volt] screenshot capture failed for ${url}:`, err instanceof Error ? err.message : String(err));
    return null;
  } finally {
    await browser?.close().catch(() => {});
  }
}

export const voltResolver: DesignResolver = {
  name: "volt",

  async canResolve(ctx) {
    const slug = slugFromUrl(ctx.url);
    if (!slug) return false;
    const exists = await voltHasDesign(slug);
    if (exists) (ctx as any)._voltSlug = slug;
    return exists;
  },

  async resolve(ctx) {
    const voltSlug = ((ctx as any)._voltSlug ?? slugFromUrl(ctx.url)) as string;
    if (!voltSlug) throw new Error(`Cannot derive volt slug from ${ctx.url}`);
    const runId = ctx.jobId;
    const now = new Date();

    // DESIGN.md stays as a reference URL (read-only)
    const designMdRef = voltDesignMdUrl(voltSlug);

    // Preview HTML gets uploaded to R2 so admin can edit it
    let previewHtmlKey: string | null = null;
    try {
      const previewResp = await fetch(voltPreviewUrl(voltSlug), {
        signal: AbortSignal.timeout(VOLT_FETCH_TIMEOUT_MS),
      });
      if (previewResp.ok) {
        const rawHtml = await previewResp.text();
        const html = rawHtml && rawHtml.length > 10 ? sanitizeVoltHtml(rawHtml) : rawHtml;
        if (html && html.length > 10) {
          previewHtmlKey = await uploadR2(
            r2KeyFor(ctx.slug, "previewHtml"),
            html,
            "text/html; charset=utf-8",
          );
        }
      }
    } catch (err) {
      console.warn(`[volt] preview fetch failed for ${voltSlug}:`, err instanceof Error ? err.message : String(err));
    }

    // Check if screenshot already exists for this slug
    const existing = await StyleMdRun.findOne(
      { slug: ctx.slug, "r2.screenshot": { $ne: null } },
    ).lean() as any;

    let screenshotKey: string | null = existing?.r2?.screenshot ?? null;

    if (!screenshotKey) {
      console.log(`[volt] no existing screenshot for ${ctx.slug}, capturing...`);
      const dataUrl = await captureScreenshot(ctx.url);
      if (dataUrl) {
        const m = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl);
        if (m) {
          screenshotKey = await uploadR2(
            r2KeyFor(ctx.slug, "screenshot"),
            Buffer.from(m[2], "base64"),
            m[1],
          );
        }
      }
    } else {
      console.log(`[volt] reusing existing screenshot for ${ctx.slug}`);
    }

    const r2Doc = {
      slug: ctx.slug,
      previewHtml: previewHtmlKey,
      designMd: designMdRef,
      screenshot: screenshotKey,
      semanticStructure: null,
      designTokens: null,
      assets: {} as Record<string, never>,
    };

    await safeWrite(() =>
      StyleMdRun.updateOne(
        { runId },
        {
          $set: {
            runId,
            url: ctx.url,
            slug: ctx.slug,
            status: "completed",
            source: "volt",
            r2: r2Doc,
            durationMs: 0,
            updatedAt: now,
            lastScrapedAt: now,
          },
          $setOnInsert: { createdAt: now },
        },
        { upsert: true },
      ),
    );

    return { runId, source: "volt", r2: r2Doc };
  },
};
