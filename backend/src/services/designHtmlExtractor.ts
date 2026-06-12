import * as cheerio from "cheerio";

// ---------------------------------------------------------------------------
// Typed design system data extracted from a preview.html
// ---------------------------------------------------------------------------

export interface ColorSwatch {
  name: string;
  hex: string;
  role: string;
}

export interface TypographyRow {
  role: string;       // e.g. "display", "body"
  spec: string;       // e.g. "Arial Black · 44px / 900"
  lineHeight: string; // e.g. "1.0"
  letterSpacing: string;
  usage: string;      // e.g. "Hero box-art wordmarks"
  previewText: string;
  previewStyles: Record<string, string>; // inline style map
}

export interface ButtonVariant {
  label: string;
  description: string;
  buttonHtml: string; // raw HTML of the button/element
}

export interface SurfaceCard {
  title: string;
  description: string;
  backgroundHex: string;
  textColor: string;
}

export interface FormElement {
  label: string;
  elementHtml: string;
}

export interface SpacingToken {
  name: string;
  value: string; // e.g. "8px"
  widthPx: number;
}

export interface RadiusToken {
  name: string;  // e.g. "xs", "none", "full"
  value: string; // e.g. "2px"
}

export interface ElevationLevel {
  description: string;
  styles: Record<string, string>;
}

export interface ResponsiveBreakpoint {
  name: string;
  width: string;
  changes: string;
}

export interface DesignSystemData {
  meta: {
    title: string;
    description: string;
  };
  nav: {
    brand: string;
    links: string[];
    ctaText: string;
  };
  hero: {
    heading: string;
    body: string;
    primaryCta: string;
    secondaryCta: string;
    backgroundHex: string;
  };
  palette: ColorSwatch[];
  typography: {
    note: string;
    rows: TypographyRow[];
  };
  buttons: ButtonVariant[];
  surfaces: SurfaceCard[];
  forms: FormElement[];
  spacing: {
    note: string;
    tokens: SpacingToken[];
  };
  radius: {
    note: string;
    tokens: RadiusToken[];
  };
  elevation: ElevationLevel[];
  responsive: {
    breakpoints: ResponsiveBreakpoint[];
    touchNote: string;
  };
  cssVariables: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Parse inline style string → object
// ---------------------------------------------------------------------------
function parseInlineStyle(style: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const decl of style.split(";")) {
    const colon = decl.indexOf(":");
    if (colon === -1) continue;
    const prop = decl.slice(0, colon).trim();
    const val = decl.slice(colon + 1).trim();
    if (prop && val) result[prop] = val;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Parse :root CSS variables from inline <style> blocks
// ---------------------------------------------------------------------------
function extractCssVariables(html: string): Record<string, string> {
  const vars: Record<string, string> = {};

  // Collect all <style> block contents
  const styleBlocks: string[] = [];
  const styleTagRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let styleMatch;
  while ((styleMatch = styleTagRegex.exec(html)) !== null) {
    styleBlocks.push(styleMatch[1]);
  }

  // Also scan the raw html for :root blocks outside style tags (e.g. Next.js inline)
  styleBlocks.push(html);

  for (const block of styleBlocks) {
    // Find ALL :root { ... } occurrences (there can be multiple; first may be in a comment)
    const rootRegex = /:root\s*\{/g;
    let rootMatch;
    while ((rootMatch = rootRegex.exec(block)) !== null) {
      const braceOpen = block.indexOf("{", rootMatch.index);
      if (braceOpen === -1) continue;

      // Walk balanced braces to find the end of the block
      let depth = 1;
      let i = braceOpen + 1;
      while (i < block.length && depth > 0) {
        if (block[i] === "{") depth++;
        else if (block[i] === "}") depth--;
        i++;
      }
      const inner = block.slice(braceOpen + 1, i - 1);

      // Only process if this block actually contains CSS variables
      if (!inner.includes("--")) continue;

      for (const line of inner.split(";")) {
        const m = line.trim().match(/^(--[\w-]+)\s*:\s*(.+)$/);
        if (m) vars[m[1]] = m[2].trim();
      }
    }
  }

  return vars;
}

// ---------------------------------------------------------------------------
// Main extractor
// ---------------------------------------------------------------------------
export function extractDesignSystemFromHtml(rawHtml: string): DesignSystemData {
  const $ = cheerio.load(rawHtml);

  // ── Meta ──────────────────────────────────────────────────────────────────
  const title = $("title").first().text().trim() || $("h1").first().text().trim();
  const description = $(".hero p").first().text().trim();

  // ── Nav ───────────────────────────────────────────────────────────────────
  const brand = $(".nav-brand").first().text().trim();
  const links: string[] = [];
  $(".nav-links li").each((_, el) => { links.push($(el).text().trim()); });
  const ctaText = $(".nav-cta").first().text().trim();

  // ── Hero ──────────────────────────────────────────────────────────────────
  const heroStyle = parseInlineStyle($(".hero").attr("style") || "");
  // Prefer inline style; fall back to scanning CSS for .hero { background: ... }
  let heroBg = heroStyle["background"] || heroStyle["background-color"] || "";
  if (!heroBg) {
    const heroMatch = rawHtml.match(/\.hero\s*\{[^}]*background(?:-color)?\s*:\s*([^;}"]+)/);
    heroBg = heroMatch?.[1]?.trim() || "";
  }
  const heading = $(".hero h1").first().text().trim();
  const heroBody = $(".hero p").first().text().trim();
  const [primaryCta, secondaryCta] = $(".hero-actions button")
    .map((_, el) => $(el).text().trim())
    .get();

  // ── Color Palette ─────────────────────────────────────────────────────────
  const palette: ColorSwatch[] = [];
  $(".swatch").each((_, el) => {
    const fillStyle = parseInlineStyle($(el).find(".swatch-fill").attr("style") || "");
    const hex = fillStyle["background"] || fillStyle["background-color"] || "";
    const name = $(el).find(".swatch-name").text().trim();
    const role = $(el).find(".swatch-role").text().trim();
    if (hex && name) palette.push({ name, hex, role });
  });

  // ── Typography ────────────────────────────────────────────────────────────
  // The note is the <p> immediately after the heading in that section
  const typographySection = $("section").filter((_, el) =>
    $(el).find(".section-eyebrow").text().includes("02")
  ).first();
  const typographyNote = typographySection.find("p").first().text().trim();

  const typographyRows: TypographyRow[] = [];
  typographySection.find(".type-row").each((_, el) => {
    const metaLines = $(el).find(".type-meta").html()?.split(/<br\s*\/?>/i) ?? [];
    const clean = metaLines.map((s) => cheerio.load(s).text().trim()).filter(Boolean);
    // clean[0] = role, clean[1] = font spec, clean[2] = lh/ls, clean[3] = usage hint
    const role = clean[0] ?? "";
    const spec = clean[1] ?? "";
    const lhLs = clean[2] ?? "";
    const usage = clean[3] ?? "";

    const lhMatch = lhLs.match(/lh\s*([\d.]+)/);
    const lsMatch = lhLs.match(/ls\s*([\d.]+\w*)/);

    const previewEl = $(el).children().last();
    const previewText = previewEl.text().trim();
    const previewStyles = parseInlineStyle(previewEl.attr("style") || "");

    typographyRows.push({
      role,
      spec,
      lineHeight: lhMatch?.[1] ?? "",
      letterSpacing: lsMatch?.[1] ?? "",
      usage,
      previewText,
      previewStyles,
    });
  });

  // ── Buttons ───────────────────────────────────────────────────────────────
  const buttonsSection = $("section").filter((_, el) =>
    $(el).find(".section-eyebrow").text().includes("03")
  ).first();

  const buttons: ButtonVariant[] = [];
  buttonsSection.find(".demo-card").each((_, el) => {
    const label = $(el).find(".label").first().text().trim();
    const desc = $(el).find("p").last().text().trim();
    // Remove the label and description, keep the interactive element HTML
    const clone = $(el).clone();
    clone.find(".label, p").remove();
    const buttonHtml = clone.html()?.trim() ?? "";
    buttons.push({ label, description: desc, buttonHtml });
  });

  // ── Cards & Surfaces ──────────────────────────────────────────────────────
  const surfacesSection = $("section").filter((_, el) =>
    $(el).find(".section-eyebrow").text().includes("04")
  ).first();

  const surfaces: SurfaceCard[] = [];
  surfacesSection.find(".feature-card").each((_, el) => {
    const inlineStyle = parseInlineStyle($(el).attr("style") || "");
    const bg = inlineStyle["background"] || inlineStyle["background-color"] || "#ffffff";
    const textColor = inlineStyle["color"] || "#21242e";
    const cardTitle = $(el).find("h4").first().text().trim();
    const cardDesc = $(el).find("p").first().text().trim();
    surfaces.push({ title: cardTitle, description: cardDesc, backgroundHex: bg, textColor });
  });

  // ── Form Elements ─────────────────────────────────────────────────────────
  const formsSection = $("section").filter((_, el) =>
    $(el).find(".section-eyebrow").text().includes("05")
  ).first();

  const forms: FormElement[] = [];
  formsSection.find(".demo-card").each((_, el) => {
    const label = $(el).find(".label").first().text().trim();
    const clone = $(el).clone();
    clone.find(".label").remove();
    const elementHtml = clone.html()?.trim() ?? "";
    forms.push({ label, elementHtml });
  });

  // ── Spacing ───────────────────────────────────────────────────────────────
  const spacingSection = $("section").filter((_, el) =>
    $(el).find(".section-eyebrow").text().includes("06")
  ).first();
  const spacingNote = spacingSection.find("p").first().text().trim();

  const spacingTokens: SpacingToken[] = [];
  spacingSection.find(".spacing-row > div").each((_, el) => {
    const labelText = $(el).find(".spacing-label").text().trim(); // "xxs\n2px"
    const [name, value] = labelText.split(/\n/).map((s) => s.trim());
    const boxStyle = parseInlineStyle($(el).find(".spacing-box").attr("style") || "");
    const widthStr = boxStyle["width"] || "0px";
    const widthPx = parseInt(widthStr) || 0;
    if (name) spacingTokens.push({ name, value: value ?? widthStr, widthPx });
  });

  // ── Border Radius ─────────────────────────────────────────────────────────
  const radiusSection = $("section").filter((_, el) =>
    $(el).find(".section-eyebrow").text().includes("07")
  ).first();
  const radiusNote = radiusSection.find("p").first().text().trim();

  const radiusTokens: RadiusToken[] = [];
  radiusSection.find(".radius-row > div").each((_, el) => {
    const name = $(el).find(".radius-label").text().trim();
    const boxStyle = parseInlineStyle($(el).find(".radius-box").attr("style") || "");
    const value = boxStyle["border-radius"] || "0px";
    if (name) radiusTokens.push({ name, value });
  });

  // ── Elevation ─────────────────────────────────────────────────────────────
  const elevSection = $("section").filter((_, el) =>
    $(el).find(".section-eyebrow").text().includes("08")
  ).first();

  const elevation: ElevationLevel[] = [];
  elevSection.find(".elev-card").each((_, el) => {
    const desc = $(el).text().trim();
    const styles = parseInlineStyle($(el).attr("style") || "");
    elevation.push({ description: desc, styles });
  });

  // ── Responsive ────────────────────────────────────────────────────────────
  const responsiveSection = $("section").filter((_, el) =>
    $(el).find(".section-eyebrow").text().includes("09")
  ).first();

  const breakpoints: ResponsiveBreakpoint[] = [];
  responsiveSection.find(".responsive-table tbody tr").each((_, el) => {
    const cells = $(el).find("td").map((__, td) => $(td).text().trim()).get();
    if (cells.length >= 3) {
      breakpoints.push({ name: cells[0], width: cells[1], changes: cells[2] });
    }
  });
  const touchNote = responsiveSection.find("p").last().text().trim();

  // ── CSS Variables ─────────────────────────────────────────────────────────
  const cssVariables = extractCssVariables(rawHtml);

  return {
    meta: { title, description },
    nav: { brand, links, ctaText },
    hero: {
      heading,
      body: heroBody,
      primaryCta: primaryCta ?? "",
      secondaryCta: secondaryCta ?? "",
      backgroundHex: heroBg,
    },
    palette,
    typography: { note: typographyNote, rows: typographyRows },
    buttons,
    surfaces,
    forms,
    spacing: { note: spacingNote, tokens: spacingTokens },
    radius: { note: radiusNote, tokens: radiusTokens },
    elevation,
    responsive: { breakpoints, touchNote },
    cssVariables,
  };
}
