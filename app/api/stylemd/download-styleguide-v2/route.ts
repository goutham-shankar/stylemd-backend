import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { NextResponse } from "next/server";
import { getStyleMdRunDir } from "@/lib/stylemd-artifacts/artifacts";

export const runtime = "nodejs";

function rewriteFontUrlsToAbsolute(html: string, runId: string): string {
  // Pattern to match url() references in CSS (font files)
  const fontUrlRegex = /url\(\s*(["']?)([^"')]*\.(?:woff2?|ttf|otf|eot))\1\s*\)/gi;
  
  return html.replace(fontUrlRegex, (_match, quote: string, fontPath: string) => {
    if (!fontPath) return _match;
    
    // Normalize the path - remove leading ../ to get relative to run root
    let cleanPath = fontPath.replace(/^\.\.\/+/, "");
    
    // Create absolute URL for the font from the API
    const absoluteUrl = `/styleguide-files/${encodeURIComponent(runId)}/${cleanPath}`;
    return `url(${quote || "\""}${absoluteUrl}${quote || "\""})`;
  });
}

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const runId = url.searchParams.get("runId");

    if (!runId || typeof runId !== "string") {
      return NextResponse.json({ ok: false, error: "runId parameter is required." }, { status: 400 });
    }

    const runDir = getStyleMdRunDir(runId);
    const showcasePath = join(runDir, "styleguide", "showcase.html");

    // Read the HTML file
    const htmlBuffer = await readFile(showcasePath);
    let htmlContent = htmlBuffer.toString("utf-8");

    // Rewrite font URLs to absolute paths so they work when downloaded
    htmlContent = rewriteFontUrlsToAbsolute(htmlContent, runId);

    // Add KIMI AI attribution to the HTML
    const timestamp = new Date().toISOString();
    const attribution = `<!-- Generated with KIMI AI StyleMD at ${timestamp} -->`;
    const footer = `<!-- Styleguide generated with KIMI AI - https://github.com/stylemd/kimi -->`;
    
    // Insert attribution after opening tags
    htmlContent = htmlContent
      .replace(/(<html[^>]*>)/i, `$1\n${attribution}`)
      .replace(/(<\/body>)/i, `  ${footer}\n$1`);

    // Return the enhanced HTML with download headers
    return new Response(htmlContent, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `attachment; filename="styleguide-${runId}.html"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return NextResponse.json(
        { ok: false, error: "Styleguide HTML not found for this run." },
        { status: 404 },
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
