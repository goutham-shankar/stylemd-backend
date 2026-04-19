import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { getStyleMdRunDir } from "@/lib/stylemd-artifacts/artifacts";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ runId?: string }> },
): Promise<Response> {
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
    const htmlContent = htmlBuffer.toString("utf-8");

    // Add KIMI AI attribution to the HTML
    const timestamp = new Date().toISOString();
    const attribution = `<!-- Generated with KIMI AI at ${timestamp} -->`;
    
    // Insert attribution after opening <html> tag or at the beginning
    const enhanced = htmlContent
      .replace(/(<html[^>]*>)/i, `$1\n${attribution}`)
      .replace(/(<body[^>]*>)/i, (match) => {
        const footer = `\n<!-- Generated with KIMI AI StyleMD: https://github.com/stylemd/kimi -->`;
        return match + footer;
      });

    // Return the enhanced HTML with download headers
    return new Response(enhanced, {
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
