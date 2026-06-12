import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Converts a URL into a filesystem-safe slug.
// e.g. "https://getdesign.md/design-md/nintendo-2001/preview" → "getdesign.md_design-md_nintendo-2001_preview"
function urlToSlug(url: string): string {
  try {
    const { hostname, pathname } = new URL(url);
    const pathSlug = pathname.replace(/^\/+|\/+$/g, "").replace(/\//g, "_") || "index";
    return `${hostname}_${pathSlug}`.replace(/[^a-z0-9_\-\.]/gi, "_").slice(0, 120);
  } catch {
    return url.replace(/[^a-z0-9_\-]/gi, "_").slice(0, 120);
  }
}

function runsDir(): string {
  return join(process.cwd(), "runs");
}

export function getRunFilePath(url: string): string {
  return join(runsDir(), urlToSlug(url), "preview.html");
}

export function getRunUrl(url: string): string {
  const slug = urlToSlug(url);
  return `/runs/${slug}/preview.html`;
}

export async function saveRunHtml(url: string, html: string): Promise<{ filePath: string; serveUrl: string }> {
  const slug = urlToSlug(url);
  const dir = join(runsDir(), slug);
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, "preview.html");
  await writeFile(filePath, html, "utf-8");
  return { filePath, serveUrl: `/runs/${slug}/preview.html` };
}

export async function saveRunDesignMd(url: string, md: string): Promise<{ filePath: string; serveUrl: string }> {
  const slug = urlToSlug(url);
  const dir = join(runsDir(), slug);
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, "design.md");
  await writeFile(filePath, md, "utf-8");
  return { filePath, serveUrl: `/runs/${slug}/design.md` };
}
