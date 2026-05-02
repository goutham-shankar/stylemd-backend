import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Request, Response } from "express";
import { getStyleMdRunDir } from "@/lib/stylemd-artifacts/artifacts";

function rewriteFontUrlsToAbsolute(html: string, runId: string): string {
  const fontUrlRegex = /url\(\s*(["']?)([^"')]*\.(?:woff2?|ttf|otf|eot))\1\s*\)/gi;
  return html.replace(fontUrlRegex, (_match: string, quote: string, fontPath: string) => {
    if (!fontPath) return _match;
    const cleanPath = fontPath.replace(/^\.\.\/+/, "");
    const absoluteUrl = `/styleguide-files/${encodeURIComponent(runId)}/${cleanPath}`;
    return `url(${quote || '"'}${absoluteUrl}${quote || '"'})`;
  });
}

export async function downloadStyleguideV2(req: Request, res: Response): Promise<void> {
  try {
    const runId = req.query["runId"];
    if (!runId || typeof runId !== "string") {
      res.status(400).json({ ok: false, error: "runId parameter is required." });
      return;
    }
    const runDir = getStyleMdRunDir(runId);
    const showcasePath = join(runDir, "styleguide", "showcase.html");
    const htmlBuffer = await readFile(showcasePath);
    let htmlContent = htmlBuffer.toString("utf-8");
    htmlContent = rewriteFontUrlsToAbsolute(htmlContent, runId);
    const timestamp = new Date().toISOString();
    const attribution = `<!-- Generated with KIMI AI StyleMD at ${timestamp} -->`;
    const footer = `<!-- Styleguide generated with KIMI AI -->`;
    htmlContent = htmlContent.replace(/(<html[^>]*>)/i, `$1\n${attribution}`).replace(/(<\/body>)/i, `  ${footer}\n$1`);
    res.setHeader("Content-Type", "text/html; charset=utf-8")
       .setHeader("Content-Disposition", `attachment; filename="styleguide-${runId}.html"`)
       .setHeader("Cache-Control", "no-store")
       .send(htmlContent);
  } catch (err: any) {
    if (err.code === "ENOENT") {
      res.status(404).json({ ok: false, error: "Styleguide HTML not found for this run." });
      return;
    }
    res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}
