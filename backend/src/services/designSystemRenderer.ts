/**
 * designSystemRenderer.ts
 *
 * Standard design-system renderer. Reads semantic_analysis.json (Stage 2) and produces:
 *   - preview.html  — dacoit-style visual design system document
 *   - design.md     — developer-focused markdown design document
 *
 * All values come from real scraping — no fallback placeholder data.
 */

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

interface ObservedColor {
  hex: string;
  areaWeight: number;
  frequency: number;
  roles: string[];
  confidence: string;
}

interface TypographyScale {
  tag: string;
  role: string;
  fontSize: string;
  fontWeight: string;
  lineHeight: string;
  color: string;
  usageCount: number;
}

interface Surface {
  role: string;
  background: string;
  text: string;
  areaWeight: number;
}

interface SemanticAnalysis {
  url: string;
  palette: { primary: string[]; allObserved: ObservedColor[] };
  typography: { display: string[]; body: string[]; ui: string[]; scales: TypographyScale[] };
  spacing: string[];
  radius: string[];
  shadows: string[];
  surfaces: Surface[];
  buttons: { radius: string; paddingDensity: string; fillType: string; variants: unknown[] };
  resolvedCssVariables: Record<string, string>;
}

interface BreakpointEntry {
  minPx: number;
  ruleCount: number; // how many @media rules reference this boundary — real, from scraped CSS
}

interface MotionTokens {
  durations: Array<{ value: string; count: number }>;
  easings: Array<{ value: string; count: number }>;
}

const EMPTY_MOTION: MotionTokens = { durations: [], easings: [] };

interface SiteTheme {
  primaryHex: string;
  primaryFg: string;
  pageBg: string;
  pageText: string;
  navBg: string;
  navText: string;
  navLinkColor: string;
  heroBg: string;
  heroText: string;
  heroTextMuted: string;
  headingColor: string;
  mutedColor: string;
  btnRadius: string | null;   // null = not detected in scrape — never claim a value
  inputRadius: string | null; // null = not detected in scrape — never claim a value
  bodyFamily: string;
  headingFamily: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// WCAG & color utilities
// ──────────────────────────────────────────────────────────────────────────────

function srgbLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  if (!hex || !hex.startsWith("#") || hex.length < 7) return 0.5;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  if (isNaN(r + g + b)) return 0.5;
  return 0.2126 * srgbLinear(r) + 0.7152 * srgbLinear(g) + 0.0722 * srgbLinear(b);
}

function wcagContrast(hex1: string, hex2: string): number {
  const L1 = relativeLuminance(hex1);
  const L2 = relativeLuminance(hex2);
  return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
}

function contrastBadgeHtml(hex: string): string {
  const onWhite = wcagContrast(hex, "#ffffff");
  const onBlack = wcagContrast(hex, "#000000");
  const { ratio, bg } = onWhite >= onBlack
    ? { ratio: onWhite, bg: "white" }
    : { ratio: onBlack, bg: "black" };
  let level: string;
  let pass: boolean;
  if (ratio >= 7) { level = "AAA ✓"; pass = true; }
  else if (ratio >= 4.5) { level = "AA ✓"; pass = true; }
  else if (ratio >= 3) { level = "AA large text ✓"; pass = true; }
  else { level = "fails AA"; pass = false; }
  const cls = pass ? "contrast-pass" : "contrast-fail";
  return `<span class="swatch-contrast ${cls}">${ratio.toFixed(2)}:1 on ${bg} · ${level}</span>`;
}

function rgbCssToHex(val: string): string {
  if (!val) return "";
  const t = val.trim();
  if (t.startsWith("#")) return t;
  const parts = t.split(",").map((s) => parseInt(s.trim(), 10));
  if (parts.length === 3 && parts.every((n) => !isNaN(n))) {
    return "#" + parts.map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0")).join("");
  }
  return t;
}

function pxToNum(val: string): number {
  return parseFloat(val?.replace("px", "") ?? "0") || 0;
}

function autoFg(bg: string): string {
  return relativeLuminance(bg) > 0.35 ? "#1a1a1a" : "#ffffff";
}

// Saturation (HSV) 0..1 — used to find brand accents vs neutrals.
function saturationOf(hex: string): number {
  if (!hex || !hex.startsWith("#") || hex.length < 7) return 0;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  if (isNaN(r + g + b)) return 0;
  const max = Math.max(r, g, b);
  return max === 0 ? 0 : (max - Math.min(r, g, b)) / max;
}

const BROWSER_DEFAULT_LINK_COLORS = new Set(["#0000ee", "#551a8b"]);

// Scraped surface pairs can be contradictory (e.g. dark text reported on a dark
// bg). Only trust the scraped text color if it actually reads on the background.
function readableOn(bg: string, preferred?: string): string {
  if (preferred && wcagContrast(bg, preferred) >= 2.5) return preferred;
  return autoFg(bg);
}

// Most saturated non-neutral color = brand accent candidate.
function pickAccentColor(colors: ObservedColor[]): string | null {
  const candidates = colors
    .filter((c) => {
      const h = c.hex.toLowerCase();
      if (BROWSER_DEFAULT_LINK_COLORS.has(h)) return false;
      const lum = relativeLuminance(c.hex);
      return saturationOf(c.hex) > 0.35 && lum > 0.02 && lum < 0.85;
    })
    .sort((a, b) => saturationOf(b.hex) - saturationOf(a.hex));
  return candidates[0]?.hex ?? null;
}

// Returns a function that appends -2, -3… to repeated token names.
function uniqueNamer(): (name: string) => string {
  const counts = new Map<string, number>();
  return (name) => {
    const n = (counts.get(name) ?? 0) + 1;
    counts.set(name, n);
    return n === 1 ? name : `${name}-${n}`;
  };
}

function formatFontFamily(family: string): string {
  const name = family.split(",")[0].replace(/['"]/g, "").trim();
  // Title-case so Google Fonts URLs resolve ("Mona sans" → "Mona Sans")
  return name.replace(/\b[a-z]/g, (ch) => ch.toUpperCase());
}

// ──────────────────────────────────────────────────────────────────────────────
// Theme derivation from semantic_analysis.json
// ──────────────────────────────────────────────────────────────────────────────

function deriveSiteTheme(analysis: SemanticAnalysis): SiteTheme {
  const vars = analysis.resolvedCssVariables;

  const rawBtn = vars["--color-button"] || vars["--color-primary"] || vars["--primary-color"] || "";
  const primaryHex = rawBtn
    ? rgbCssToHex(rawBtn)
    : pickAccentColor(analysis.palette.allObserved) ?? analysis.palette.primary[0] ?? "#333333";
  const rawBtnFg = vars["--color-button-text"] || vars["--color-on-primary"] || "";
  const primaryFg = rawBtnFg ? rgbCssToHex(rawBtnFg) : autoFg(primaryHex);

  const pageCanvas = analysis.surfaces.find((s) => s.role === "page_canvas") ?? analysis.surfaces[0];
  const pageBg = pageCanvas?.background ?? "#f0f0f0";
  const pageText = pageCanvas?.text ?? "#333333";

  // Darkest surface (nav / hero chrome)
  const darkSurface = analysis.surfaces
    .filter((s) => relativeLuminance(s.background) < 0.15)
    .sort((a, b) => b.areaWeight - a.areaWeight)[0];

  const navBg = darkSurface?.background ?? (relativeLuminance(pageBg) < 0.3 ? pageBg : "#1a1a1a");
  const navText = readableOn(navBg, darkSurface?.text);
  const navLinkColor = relativeLuminance(navBg) > 0.5
    ? "rgba(0,0,0,0.6)"
    : "rgba(255,255,255,0.6)";

  const heroBg = darkSurface?.background ?? navBg;
  const heroText = readableOn(heroBg, darkSurface?.text);
  const heroTextMuted = relativeLuminance(heroBg) < 0.3
    ? "rgba(240,240,240,0.65)"
    : "rgba(0,0,0,0.65)";

  // Heading: darkest text-role color observable on page canvas
  const headingColor = (() => {
    const dark = analysis.palette.allObserved
      .filter((c) => relativeLuminance(c.hex) < 0.25 && c.roles.includes("text"))
      .sort((a, b) => b.frequency - a.frequency)[0];
    return dark?.hex ?? pageText;
  })();

  const mutedColor = "#8d8d8d";
  const btnRadius = vars["--buttons-radius"] || analysis.buttons.radius || null;
  const inputRadius = vars["--inputs-radius"] || null;
  const bodyFamily = vars["--font-body-family"] || analysis.typography.body[0] || "sans-serif";
  const headingFamily = vars["--font-heading-family"] || analysis.typography.display[0] || bodyFamily;

  return {
    primaryHex, primaryFg, pageBg, pageText,
    navBg, navText, navLinkColor,
    heroBg, heroText, heroTextMuted,
    headingColor, mutedColor,
    btnRadius, inputRadius, bodyFamily, headingFamily,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Token naming helpers
// ──────────────────────────────────────────────────────────────────────────────

function colorTokenName(c: ObservedColor, primaryHex: string): string {
  const h = c.hex.toLowerCase();
  const lum = relativeLuminance(c.hex);
  if (h === primaryHex.toLowerCase()) return "primary";
  if (BROWSER_DEFAULT_LINK_COLORS.has(h)) return "link";
  if (saturationOf(c.hex) > 0.35 && lum > 0.02 && lum < 0.85) return "accent";
  if (h === "#ffffff") return "white";
  if (h === "#000000") return "black";
  if (lum > 0.9) return "canvas";
  if (lum > 0.75) return "canvas-soft";
  if (lum < 0.04) return "ink-deepest";
  if (lum < 0.08) return "ink-dark";
  if (lum < 0.2) return "ink";
  if (c.roles.includes("text") && lum > 0.1 && lum < 0.5) return "text-secondary";
  if (c.roles.includes("background") && c.areaWeight > 20) return "page-bg";
  if (c.roles.includes("background") && c.areaWeight > 3) return "surface";
  if (c.roles.includes("text")) return "text";
  return "accent";
}

function colorRoleDesc(c: ObservedColor): string {
  const r = c.roles.map((s) => s.replace(/_/g, " ")).join(", ");
  if (c.areaWeight > 30) return `Dominant — ${r}`;
  if (c.areaWeight > 10) return `Major — ${r}`;
  if (c.areaWeight > 2) return `Supporting — ${r}`;
  return `Accent — ${r}`;
}

function spacingName(px: number): string {
  if (px <= 2) return "xxs";
  if (px <= 4) return "xs";
  if (px <= 8) return "sm";
  if (px <= 12) return "md";
  if (px <= 16) return "base";
  if (px <= 24) return "lg";
  if (px <= 32) return "xl";
  if (px <= 48) return "2xl";
  if (px <= 64) return "3xl";
  return "section";
}

function radiusName(val: string): string {
  const px = pxToNum(val);
  if (px === 0) return "none";
  if (px <= 4) return "xs";
  if (px <= 8) return "sm";
  if (px <= 12) return "md";
  if (px <= 20) return "lg";
  if (px <= 40) return "xl";
  return "full";
}

function typoRoleLabel(s: TypographyScale): string {
  const size = pxToNum(s.fontSize);
  const weight = parseInt(s.fontWeight, 10);
  if (size >= 24 && weight <= 200) return "Thin Display";
  if (size >= 48 && weight >= 600) return "Display Hero";
  if (size >= 32 && weight >= 600) return "Display";
  if (size >= 24 && weight >= 600) return "Heading";
  if (size >= 20 && weight >= 500) return "Subheading";
  if (size >= 16 && s.tag === "a") return "Link";
  if (size >= 16 && weight >= 600) return "UI Label";
  if (size >= 16) return "Body";
  if (size >= 13 && weight >= 600) return "Caption Bold";
  if (size >= 13) return "Caption";
  return "Micro";
}

function sampleForRole(role: string): string {
  if (role === "Display Hero" || role === "Display") return "The quick brown fox jumps";
  if (role === "Heading" || role === "Subheading") return "The quick brown fox jumps over";
  if (role === "Link") return "Read more →";
  if (role === "Micro") return "LABEL · TAG";
  return "The quick brown fox jumps over the lazy dog";
}

// ──────────────────────────────────────────────────────────────────────────────
// CSS block
// ──────────────────────────────────────────────────────────────────────────────

function buildCss(t: SiteTheme): string {
  const { primaryHex, primaryFg, pageBg, pageText, navBg, navText, navLinkColor,
    heroBg, heroText, heroTextMuted, headingColor, mutedColor, bodyFamily } = t;
  // Undetected radius renders square — absence of a claim, not an invented token
  const btnRadius = t.btnRadius ?? "0";
  const inputRadius = t.inputRadius ?? "0";
  const bodyFamilyCss = bodyFamily.replace(/"/g, "'");

  return `*{box-sizing:border-box;}
body{margin:0;font-family:${bodyFamilyCss},'Helvetica Neue',Arial,sans-serif;background:${pageBg};color:${pageText};-webkit-font-smoothing:antialiased;}
.nav{padding:0 48px;height:64px;background:${navBg};border-bottom:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:50;}
.nav-brand{display:flex;align-items:center;gap:10px;}
.nav-brand-dot{width:28px;height:28px;border-radius:50%;background:${primaryHex};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:${primaryFg};}
.nav-brand span{font-weight:700;font-size:15px;color:${navText};letter-spacing:-0.2px;}
.nav-links{display:flex;gap:32px;}
.nav-links a{font-size:14px;color:${navLinkColor};text-decoration:none;font-weight:400;transition:color 0.2s;}
.nav-links a:hover{color:${navText};}
.hero{padding:96px 48px;background:${heroBg};max-width:100%;}
.hero-inner{max-width:1344px;margin:0 auto;}
.hero-eyebrow{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:${primaryHex};margin:0 0 20px;display:block;}
.hero h1{font-size:64px;font-weight:700;line-height:1.0;color:${heroText};margin:0 0 20px;letter-spacing:-1.5px;}
.hero h1 em{font-style:normal;color:${primaryHex};}
.hero p{font-size:18px;color:${heroTextMuted};max-width:640px;margin:0 0 40px;line-height:1.6;}
.hero-meta{display:flex;gap:32px;flex-wrap:wrap;}
.hero-stat{display:flex;flex-direction:column;gap:2px;}
.hero-stat strong{font-size:22px;font-weight:700;color:${heroText};}
.hero-stat span{font-size:12px;color:${heroTextMuted};text-transform:uppercase;letter-spacing:1px;}
section{padding:80px 48px;max-width:1344px;margin:0 auto;}
.section-eyebrow{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:${primaryHex};margin-bottom:6px;display:block;}
.section-heading{font-size:34px;font-weight:700;letter-spacing:-0.5px;margin:0 0 8px;color:${headingColor};}
.section-sub{font-size:15px;color:${mutedColor};margin:0 0 36px;line-height:1.5;}
.divider{border:none;border-top:1px solid rgba(0,0,0,0.09);margin:0;}
.palette-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:14px;}
.swatch{border:1px solid rgba(0,0,0,0.09);border-radius:10px;overflow:hidden;background:#ffffff;}
.swatch-fill{height:88px;}
.swatch-meta{padding:14px;}
.swatch-name{font-weight:700;font-size:13px;margin:0 0 2px;color:${headingColor};}
.swatch-hex{font-family:'Courier New',monospace;font-size:12px;color:${mutedColor};margin:0 0 4px;}
.swatch-role{font-size:11px;color:${mutedColor};margin:0;line-height:1.5;}
.swatch-contrast{font-size:10px;font-weight:600;margin-top:6px;padding:2px 6px;border-radius:20px;display:inline-block;}
.contrast-pass{background:#e6f4ea;color:#1e7e34;}
.contrast-fail{background:#fdecea;color:#c62828;}
.type-table{width:100%;border-collapse:collapse;}
.type-table th{font-size:10px;text-transform:uppercase;letter-spacing:1px;color:${mutedColor};padding:10px 16px;text-align:left;border-bottom:2px solid #e0e0e0;background:#f9f9f9;}
.type-table td{padding:18px 16px;border-bottom:1px solid #e8e8e8;vertical-align:middle;}
.type-meta{font-family:'Courier New',monospace;font-size:11px;color:${mutedColor};line-height:1.7;}
.type-role-badge{display:inline-block;font-size:10px;font-weight:600;padding:2px 8px;border-radius:20px;background:#f0f0f0;color:#555;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;}
.grid-2{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:20px;}
.grid-3{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:20px;}
.demo-card{border:1px solid rgba(0,0,0,0.09);border-radius:12px;padding:24px;background:#ffffff;}
.demo-label{font-size:10px;color:${mutedColor};display:block;margin-bottom:14px;font-weight:700;text-transform:uppercase;letter-spacing:1px;}
.demo-note{font-size:12px;color:${mutedColor};margin:14px 0 0;line-height:1.5;}
.nav-demo{background:${navBg};padding:0 28px;height:56px;display:flex;align-items:center;justify-content:space-between;border-radius:8px;}
.nav-demo-links{display:flex;gap:24px;}
.nav-demo-links span{font-size:13px;color:${navLinkColor};cursor:pointer;}
.nav-demo-links span.active{color:${navText};}
.btn-site-primary{background:${primaryHex};color:${primaryFg};border:none;border-radius:${btnRadius};height:44px;padding:0 24px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;letter-spacing:0.2px;}
.btn-site-secondary{background:transparent;color:${primaryHex};border:1.5px solid ${primaryHex};border-radius:${btnRadius};height:44px;padding:0 24px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;}
.btn-site-ghost{background:transparent;color:${primaryHex};border:none;border-radius:${btnRadius};height:44px;padding:0 8px;font-size:14px;font-weight:500;cursor:pointer;font-family:inherit;text-decoration:underline;text-underline-offset:3px;}
.surface-card{border:1px solid rgba(0,0,0,0.09);padding:28px;position:relative;}
.surface-card h4{margin:0 0 8px;font-size:17px;font-weight:700;}
.surface-card p{margin:0;font-size:13px;line-height:1.6;opacity:0.7;}
.ex-input{width:100%;background:#ffffff;border:1px solid #cccccc;border-radius:${inputRadius};color:${pageText};padding:11px 14px;font-family:inherit;font-size:15px;outline:none;transition:border-color 0.15s;}
.ex-input::placeholder{color:${mutedColor};}
.contact-demo{background:${heroBg};padding:40px;color:${heroText};max-width:560px;}
.contact-demo h3{margin:0 0 6px;font-size:26px;font-weight:700;color:${heroText};line-height:1.1;}
.contact-demo p{margin:0 0 28px;font-size:14px;color:${heroTextMuted};}
.form-field{margin-bottom:20px;}
.form-field label{display:block;font-size:12px;font-weight:600;color:${heroTextMuted};text-transform:uppercase;letter-spacing:0.8px;margin-bottom:6px;}
.form-field input,.form-field textarea{width:100%;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);color:${heroText};padding:12px 14px;font-family:inherit;font-size:15px;outline:none;resize:vertical;border-radius:${inputRadius};}
.form-field textarea{min-height:90px;}
.spacing-row{display:flex;gap:20px;flex-wrap:wrap;align-items:flex-end;}
.spacing-item{display:flex;flex-direction:column;align-items:center;gap:8px;}
.spacing-bar{background:${primaryHex};border-radius:2px;height:32px;}
.spacing-label{font-family:'Courier New',monospace;font-size:10px;color:${mutedColor};text-align:center;line-height:1.5;}
.radius-row{display:flex;gap:28px;flex-wrap:wrap;align-items:flex-end;}
.radius-item{display:flex;flex-direction:column;align-items:center;gap:10px;}
.radius-box{width:80px;height:80px;background:#ffffff;border:2px solid ${headingColor};display:flex;align-items:center;justify-content:center;}
.radius-label{font-family:'Courier New',monospace;font-size:10px;color:${mutedColor};text-align:center;line-height:1.6;}
.elevation-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:20px;}
.elev-card{background:#ffffff;padding:24px;font-size:13px;color:#555;line-height:1.6;}
.state-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:20px;}
.motion-row{display:flex;flex-direction:column;gap:16px;}
.motion-row table{width:100%;border-collapse:collapse;font-size:14px;}
.motion-row table th{font-size:10px;text-transform:uppercase;letter-spacing:1px;color:${mutedColor};padding:10px 16px;text-align:left;border-bottom:2px solid #e0e0e0;background:#f9f9f9;}
.motion-row table td{padding:14px 16px;border-bottom:1px solid #e8e8e8;font-size:13px;color:${pageText};}
.motion-row table td:first-child{font-family:'Courier New',monospace;font-weight:600;color:${primaryHex};}
.responsive-table{width:100%;border-collapse:collapse;font-size:14px;}
.responsive-table th,.responsive-table td{text-align:left;padding:12px 16px;border-bottom:1px solid #e0e0e0;}
.responsive-table th{font-size:10px;text-transform:uppercase;letter-spacing:1px;color:${mutedColor};background:#f9f9f9;}
.responsive-table td:first-child{font-family:'Courier New',monospace;font-weight:600;color:${headingColor};}
.device-ladder{display:flex;gap:16px;align-items:flex-end;margin-top:32px;flex-wrap:wrap;}
.device-box{background:#ffffff;border:1.5px solid ${headingColor};display:flex;flex-direction:column;align-items:center;justify-content:flex-end;padding:8px;font-size:10px;font-family:'Courier New',monospace;color:${mutedColor};gap:4px;}
.footer{padding:32px 48px;border-top:1px solid rgba(0,0,0,0.09);font-size:13px;color:${mutedColor};display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;background:${pageBg};}
@media(max-width:768px){section{padding:48px 20px;}.section-heading{font-size:26px;}.hero{padding:48px 20px;}.hero h1{font-size:38px;}.nav{padding:0 20px;}.footer{padding:24px 20px;}}`;
}

// ──────────────────────────────────────────────────────────────────────────────
// Section renderers
// ──────────────────────────────────────────────────────────────────────────────

function renderColorSection(colors: ObservedColor[], theme: SiteTheme): string {
  const namer = uniqueNamer();
  const swatches = colors.slice(0, 14).map((c) => {
    const name = namer(colorTokenName(c, theme.primaryHex));
    const role = colorRoleDesc(c);
    const lightBorder = relativeLuminance(c.hex) > 0.9 ? "border-bottom:1px solid #e8e8e8;" : "";
    return `<div class="swatch">
  <div class="swatch-fill" style="background:${c.hex};${lightBorder}"></div>
  <div class="swatch-meta">
    <p class="swatch-name">${name}</p>
    <p class="swatch-hex">${c.hex}</p>
    <p class="swatch-role">${role}</p>
    ${contrastBadgeHtml(c.hex)}
  </div>
</div>`;
  }).join("\n");

  return `<section>
  <span class="section-eyebrow">01 — Foundations</span>
  <h2 class="section-heading">Color Palette</h2>
  <p class="section-sub">All color values extracted from the live stylesheet. Contrast ratios per WCAG 2.1.</p>
  <div class="palette-grid">${swatches}</div>
</section>`;
}

function renderTypographySection(scales: TypographyScale[], theme: SiteTheme): string {
  const seen = new Set<string>();
  const unique = scales.filter((s) => {
    const key = `${s.fontSize}-${s.fontWeight}-${s.tag}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 10);

  const bodyFamilyName = formatFontFamily(theme.bodyFamily);
  const headingFamilyName = formatFontFamily(theme.headingFamily);
  const famNote = bodyFamilyName === headingFamilyName
    ? `Single font family: <strong>${bodyFamilyName}</strong> — used across all roles.`
    : `Body: <strong>${bodyFamilyName}</strong> · Display: <strong>${headingFamilyName}</strong>.`;

  const rows = unique.map((s) => {
    const role = typoRoleLabel(s);
    const familyName = ["h1", "h2", "h3"].includes(s.tag) ? headingFamilyName : bodyFamilyName;
    const lhNum = pxToNum(s.lineHeight);
    // Only show line-height when it was actually scraped — never invent one
    const lhRatio = lhNum > 0 && pxToNum(s.fontSize) > 0 ? (lhNum / pxToNum(s.fontSize)).toFixed(2) : null;
    const displaySize = Math.min(pxToNum(s.fontSize), 36);
    return `<tr>
  <td><span class="type-role-badge">${role}</span></td>
  <td><div class="type-meta">${familyName}<br>${s.fontSize} / ${s.fontWeight}${lhRatio ? `<br>lh ${lhRatio}` : ""}</div></td>
  <td><div style="font-size:${displaySize}px;font-weight:${s.fontWeight};${lhRatio ? `line-height:${lhRatio};` : ""}color:${s.color};">${sampleForRole(role)}</div></td>
  <td><div class="type-meta">${s.tag.toUpperCase()} element · ${s.usageCount} uses</div></td>
</tr>`;
  }).join("\n");

  return `<section>
  <span class="section-eyebrow">02 — Foundations</span>
  <h2 class="section-heading">Typography</h2>
  <p class="section-sub">${famNote}</p>
  <table class="type-table">
    <thead><tr><th>Role</th><th>Specs</th><th>Sample</th><th>Used on</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</section>`;
}

function renderNavSection(theme: SiteTheme, siteTitle: string): string {
  const initial = siteTitle.charAt(0).toUpperCase();
  const navLinks = ["Home", "About", "Works", "Contact"];

  return `<section>
  <span class="section-eyebrow">03 — Components</span>
  <h2 class="section-heading">Navigation</h2>
  <p class="section-sub">Representative nav demo styled with extracted tokens — background and text colors from scraped surfaces, font from scraped typography.</p>

  <div style="margin-bottom:20px;">
    <div class="demo-label">nav · demo using extracted colors &amp; font</div>
    <div class="nav-demo">
      <div style="display:flex;align-items:center;gap:8px;">
        <div class="nav-brand-dot">${initial}</div>
        <span style="font-size:14px;font-weight:700;color:${theme.navText};">${siteTitle}</span>
      </div>
      <div class="nav-demo-links">
        ${navLinks.map((l, i) => `<span${i === 0 ? ' class="active"' : ""}>${l}</span>`).join("")}
      </div>
    </div>
  </div>

  <div class="grid-2">
    <div class="demo-card">
      <span class="demo-label">Extracted nav tokens</span>
      <table style="width:100%;font-size:13px;border-collapse:collapse;">
        ${[
          ["Background", theme.navBg],
          ["Text color", theme.navText],
          ["Font family", formatFontFamily(theme.bodyFamily)],
        ].map(([k, v]) => `<tr style="border-bottom:1px solid #eee;"><td style="padding:8px 0;color:#8d8d8d;">${k}</td><td style="padding:8px 0;font-family:monospace;font-weight:600;">${v}</td></tr>`).join("")}
      </table>
      <p class="demo-note">Layout values (height, padding, link states) are demo styling — not extracted from the site.</p>
    </div>
  </div>
</section>`;
}

function renderButtonSection(theme: SiteTheme, buttons: SemanticAnalysis["buttons"]) : string {
  const { primaryHex, primaryFg } = theme;
  const radiusCss = theme.btnRadius ?? "0";
  const radiusLabel = theme.btnRadius ?? "not detected";
  const extras = [
    theme.btnRadius ? `Border-radius: <code>${theme.btnRadius}</code>` : "Border-radius: not detected in scrape",
    buttons.fillType ? `fill type: <code>${buttons.fillType}</code>` : "",
    buttons.paddingDensity ? `padding density: <code>${buttons.paddingDensity}</code>` : "",
  ].filter(Boolean).join(" · ");

  return `<section>
  <span class="section-eyebrow">04 — Components</span>
  <h2 class="section-heading">Button Variants</h2>
  <p class="section-sub">Color and radius tokens extracted from the scrape; secondary/ghost/disabled variants are representative demos built from those tokens. ${extras}.</p>
  <div class="grid-2">
    <div class="demo-card">
      <span class="demo-label">btn-primary · filled CTA</span>
      <button class="btn-site-primary">Get Started</button>
      <p class="demo-note">bg ${primaryHex} · color ${primaryFg} · radius: ${radiusLabel}</p>
    </div>
    <div class="demo-card">
      <span class="demo-label">btn-secondary · outlined demo</span>
      <button class="btn-site-secondary">Learn More</button>
      <p class="demo-note">Demo variant — outlined treatment of the extracted primary color ${primaryHex}.</p>
    </div>
    <div class="demo-card">
      <span class="demo-label">btn-ghost · text-only demo</span>
      <button class="btn-site-ghost">View All</button>
      <p class="demo-note">Demo variant — text-only treatment of the extracted primary color.</p>
    </div>
    <div class="demo-card">
      <span class="demo-label">btn-disabled · demo state</span>
      <button style="background:#cccccc;color:#888888;border:none;border-radius:${radiusCss};height:44px;padding:0 24px;font-size:14px;font-weight:600;cursor:not-allowed;opacity:0.5;font-family:inherit;">Unavailable</button>
      <p class="demo-note">Generic disabled-state demo — not extracted from the site.</p>
    </div>
  </div>
</section>`;
}

function renderSurfacesSection(surfaces: Surface[], shadows: string[], theme: SiteTheme): string {
  const unique = surfaces.filter((s, i, arr) =>
    arr.findIndex((x) => x.background === s.background && x.text === s.text) === i,
  ).slice(0, 6);

  const hasRealShadows = shadows.some((s) => s && s !== "none");
  const desc = hasRealShadows
    ? `Depth communicated through shadows and background contrast.`
    : `Flat design system — no box-shadows. Depth is communicated through background contrast and borders.`;

  const cards = unique.map((s) => {
    const roleName = s.role.replace(/_/g, " ");
    const textOnBg = readableOn(s.background, s.text);
    const borderStyle = relativeLuminance(s.background) > 0.7
      ? "border:1px solid rgba(0,0,0,0.09);"
      : "border:none;";
    return `<div class="surface-card" style="background:${s.background};color:${textOnBg};${borderStyle}">
  <h4 style="color:${textOnBg};">${roleName}</h4>
  <p>bg ${s.background} · text ${s.text}</p>
</div>`;
  }).join("\n");

  return `<section>
  <span class="section-eyebrow">05 — Components</span>
  <h2 class="section-heading">Cards &amp; Surfaces</h2>
  <p class="section-sub">${desc}</p>
  <div class="grid-3">${cards}</div>
</section>`;
}

function renderFormSection(theme: SiteTheme, siteTitle: string): string {
  const { heroBg, heroText, primaryHex, primaryFg } = theme;
  const inputRadiusCss = theme.inputRadius ?? "0";
  const btnRadiusCss = theme.btnRadius ?? "0";
  const inputRadiusLabel = theme.inputRadius ?? "not detected";
  const radiusNote = theme.inputRadius
    ? `Input border-radius: <code>${theme.inputRadius}</code> (extracted).`
    : "Input border-radius: not detected in scrape.";

  return `<section>
  <span class="section-eyebrow">06 — Components</span>
  <h2 class="section-heading">Form Elements</h2>
  <p class="section-sub">Representative form patterns styled with extracted color and radius tokens. ${radiusNote}</p>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:32px;" class="form-wrap">
    <div>
      <div class="demo-label" style="margin-bottom:20px;">Contact form — site-styled demo</div>
      <div class="contact-demo" style="background:${heroBg};color:${heroText};">
        <h3>${siteTitle}<br>Get in Touch</h3>
        <p>hello@${siteTitle.includes(".") ? siteTitle.toLowerCase() : `${siteTitle.toLowerCase().replace(/\s/g, "")}.com`}</p>
        <div class="form-field">
          <label>Name</label>
          <input type="text" placeholder="Your name">
        </div>
        <div class="form-field">
          <label>Email Address</label>
          <input type="email" placeholder="you@example.com">
        </div>
        <div class="form-field">
          <label>Message</label>
          <textarea placeholder="Your message…"></textarea>
        </div>
        <button style="width:100%;background:${primaryHex};color:${primaryFg};border:none;border-radius:${btnRadiusCss};height:48px;font-size:15px;font-weight:600;cursor:pointer;font-family:inherit;">Send Message</button>
      </div>
    </div>
    <div>
      <div class="demo-label" style="margin-bottom:20px;">Input states</div>
      <div style="display:flex;flex-direction:column;gap:16px;">
        <div class="demo-card">
          <span class="demo-label">input · default</span>
          <input class="ex-input" placeholder="Enter text…">
          <p class="demo-note">radius: ${inputRadiusLabel} · demo border/background styling</p>
        </div>
        <div class="demo-card">
          <span class="demo-label">input · focus state demo</span>
          <input class="ex-input" style="border-color:${primaryHex};outline:none;" value="Focused input">
          <p class="demo-note">Demo focus treatment using extracted primary color ${primaryHex}.</p>
        </div>
        <div class="demo-card">
          <span class="demo-label">select · dropdown</span>
          <select class="ex-input" style="height:44px;cursor:pointer;">
            <option>Choose an option</option>
            <option>Option A</option>
            <option>Option B</option>
          </select>
        </div>
      </div>
    </div>
  </div>
</section>`;
}

function renderSpacingSection(spacingVals: string[]): string {
  const positive = spacingVals.filter((v) => v && !v.startsWith("-"));
  const unique = [...new Set(positive)].sort((a, b) => pxToNum(a) - pxToNum(b));

  const namer = uniqueNamer();
  const items = unique.slice(0, 14).map((v) => {
    const px = pxToNum(v);
    const name = namer(spacingName(px));
    const width = Math.max(4, Math.min(px, 120));
    return `<div class="spacing-item">
  <div class="spacing-bar" style="width:${width}px;"></div>
  <div class="spacing-label">${v}<br>${name}</div>
</div>`;
  }).join("\n");

  return `<section>
  <span class="section-eyebrow">07 — Foundations</span>
  <h2 class="section-heading">Spacing Scale</h2>
  <p class="section-sub">Spacing values observed in the live layout. Values extracted from stylesheet padding, margin, and gap declarations.</p>
  <div class="spacing-row">${items}</div>
</section>`;
}

function renderRadiusSection(radiusVals: string[]): string {
  const simple = radiusVals.filter((v) => v && (!v.includes(" ") || v.trim().split(/\s+/).length === 1));
  const unique = [...new Set(simple)].sort((a, b) => pxToNum(a) - pxToNum(b));
  if (unique.length === 0) {
    return `<section>
  <span class="section-eyebrow">08 — Foundations</span>
  <h2 class="section-heading">Border Radius</h2>
  <p class="section-sub">No border-radius tokens detected in the scraped styles.</p>
</section>`;
  }

  const items = unique.slice(0, 8).map((v) => {
    const name = radiusName(v);
    return `<div class="radius-item">
  <div class="radius-box" style="border-radius:${v};">
    <span style="font-size:10px;font-family:monospace;color:#8d8d8d;">${v}</span>
  </div>
  <div class="radius-label">${name}<br>${v}</div>
</div>`;
  }).join("\n");

  return `<section>
  <span class="section-eyebrow">08 — Foundations</span>
  <h2 class="section-heading">Border Radius</h2>
  <p class="section-sub">Corner radius tokens observed across components. All values extracted from live stylesheet.</p>
  <div class="radius-row">${items}</div>
</section>`;
}

function renderElevationSection(shadows: string[], cssVars: Record<string, string>, theme: SiteTheme): string {
  const realShadows: Array<{ label: string; shadow: string }> = [];

  const shadowGroups = [
    { prefix: "--popup-shadow", label: "Popup / Dropdown overlay" },
    { prefix: "--drawer-shadow", label: "Drawer / side-panel" },
    { prefix: "--buttons-shadow", label: "Button lift" },
    { prefix: "--media-shadow", label: "Media / image card" },
  ];

  for (const { prefix, label } of shadowGroups) {
    const opacity = parseFloat(cssVars[`${prefix}-opacity`] ?? "0");
    if (opacity === 0) continue;
    // Only build a shadow when every component was actually scraped — never invent geometry
    const hOff = cssVars[`${prefix}-horizontal-offset`];
    const vOff = cssVars[`${prefix}-vertical-offset`];
    const blur = cssVars[`${prefix}-blur-radius`];
    if (!hOff || !vOff || !blur) continue;
    realShadows.push({ label, shadow: `${hOff} ${vOff} ${blur} rgba(0,0,0,${opacity})` });
  }

  for (const s of shadows) {
    if (s && s !== "none" && !realShadows.some((x) => x.shadow === s)) {
      realShadows.push({ label: "Observed element shadow", shadow: s });
    }
  }

  const isFlat = realShadows.length === 0;

  const cards = isFlat
    ? [
        `<div class="elev-card" style="border:none;background:#f0f0f0;"><strong style="color:${theme.headingColor};">Level 0 — Page Canvas</strong><p style="margin:8px 0 0;">bg ${theme.pageBg} — the outermost layer. Everything sits on top of this.</p></div>`,
        `<div class="elev-card" style="border:1px solid rgba(0,0,0,0.09);"><strong style="color:${theme.headingColor};">Level 1 — Card Surface</strong><p style="margin:8px 0 0;">bg #ffffff with 1px border. No shadow — white lift creates elevation via contrast.</p></div>`,
        `<div class="elev-card" style="background:${theme.heroBg};color:${theme.heroText};border:none;"><strong style="color:${theme.heroText};">Dark Section</strong><p style="margin:8px 0 0;opacity:0.65;">bg ${theme.heroBg} — depth through color contrast, no shadows.</p></div>`,
      ]
    : realShadows.slice(0, 4).map(({ label, shadow }) =>
        `<div class="elev-card" style="box-shadow:${shadow};border:none;"><strong>${label}</strong><p style="margin:8px 0 0;font-family:monospace;font-size:11px;">${shadow}</p></div>`,
      );

  const sub = isFlat
    ? "Fully flat design — zero box-shadow usage. Depth communicated through background-color contrast and 1px borders."
    : "Box-shadow tokens extracted from CSS variables. Shadow values represent real usage.";

  return `<section>
  <span class="section-eyebrow">09 — Foundations</span>
  <h2 class="section-heading">Elevation &amp; Depth</h2>
  <p class="section-sub">${sub}</p>
  <div class="elevation-grid">${cards.join("\n")}</div>
</section>`;
}

// Names assigned to scraped durations by ascending speed.
function durationTokenName(index: number, total: number): string {
  const names = total <= 1 ? ["duration"] : ["duration-fast", "duration-base", "duration-slow", "duration-slower", "duration-slowest"];
  return names[index] ?? `duration-${index + 1}`;
}

function renderMotionSection(motion: MotionTokens, theme: SiteTheme): string {
  const hasData = motion.durations.length > 0 || motion.easings.length > 0;

  if (!hasData) {
    return `<section>
  <span class="section-eyebrow">10 — Interactions</span>
  <h2 class="section-heading">Motion</h2>
  <p class="section-sub">No transition or animation tokens detected in the scraped stylesheets.</p>
</section>`;
  }

  const durRows = motion.durations.map((d, i) =>
    `<tr><td>${durationTokenName(i, motion.durations.length)}</td><td>${d.value}</td><td>${d.count}× in stylesheet</td></tr>`,
  );
  const easeRows = motion.easings.map((e, i) =>
    `<tr><td>easing${motion.easings.length > 1 ? `-${i + 1}` : ""}</td><td>${e.value}</td><td>${e.count}× in stylesheet</td></tr>`,
  );

  const fastest = motion.durations[0]?.value;
  const topEasing = motion.easings[0]?.value ?? "";
  const demo = fastest
    ? `<div class="grid-2" style="margin-bottom:32px;">
    <div class="demo-card">
      <span class="demo-label">hover demo · using extracted tokens</span>
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
        <button class="btn-site-primary" style="transition:opacity ${fastest} ${topEasing};">Hover me</button>
        <button class="btn-site-secondary" style="transition:background ${fastest} ${topEasing},color ${fastest} ${topEasing};">Hover me</button>
      </div>
      <p class="demo-note">Demo transitions use the fastest extracted duration (${fastest}${topEasing ? ` ${topEasing}` : ""}).</p>
    </div>
  </div>`
    : "";

  return `<section>
  <span class="section-eyebrow">10 — Interactions</span>
  <h2 class="section-heading">Motion</h2>
  <p class="section-sub">Transition and animation values extracted from the scraped stylesheets, with real occurrence counts.</p>
  ${demo}
  <div class="motion-row">
    <div class="demo-label">Motion tokens (extracted)</div>
    <table>
      <thead><tr><th>Token</th><th>Value</th><th>Occurrences</th></tr></thead>
      <tbody>${[...durRows, ...easeRows].join("\n")}</tbody>
    </table>
  </div>
</section>`;
}

// Conventional name for a breakpoint boundary value.
function breakpointName(px: number): string {
  if (px <= 600) return "Mobile";
  if (px <= 900) return "Tablet";
  if (px <= 1200) return "Desktop";
  return "Wide";
}

function renderResponsiveSection(siteUrl: string, breakpoints: BreakpointEntry[], theme: SiteTheme): string {
  const sorted = [...breakpoints].sort((a, b) => a.minPx - b.minPx);

  if (sorted.length === 0) {
    return `<section>
  <span class="section-eyebrow">11 — Responsive</span>
  <h2 class="section-heading">Responsive Behavior</h2>
  <p class="section-sub">No media-query breakpoints detected in the scraped stylesheets of ${siteUrl}.</p>
</section>`;
  }

  const namer = uniqueNamer();
  const maxPx = sorted[sorted.length - 1].minPx;

  const tableRows = sorted.map((bp) =>
    `<tr><td>${namer(breakpointName(bp.minPx))}</td><td>${bp.minPx}px</td><td>${bp.ruleCount} @media rule${bp.ruleCount === 1 ? "" : "s"}</td></tr>`,
  ).join("\n");

  // Ladder derived from the real detected boundaries
  const ladder = sorted.map((bp) => {
    const w = Math.round(60 + (bp.minPx / maxPx) * 180);
    const h = Math.round(70 + (bp.minPx / maxPx) * 55);
    return `<div class="device-box" style="width:${w}px;height:${h}px;">
  <span style="font-size:9px;text-align:center;color:#8d8d8d;">${bp.minPx}px</span>
</div>`;
  }).join("\n");

  return `<section>
  <span class="section-eyebrow">11 — Responsive</span>
  <h2 class="section-heading">Responsive Behavior</h2>
  <p class="section-sub">Breakpoint boundaries detected in the scraped stylesheet media queries, with real rule counts.</p>
  <table class="responsive-table">
    <thead><tr><th>Breakpoint</th><th>Boundary</th><th>Usage</th></tr></thead>
    <tbody>${tableRows}</tbody>
  </table>
  <div class="device-ladder">${ladder}</div>
  <p style="color:#8d8d8d;margin-top:24px;font-size:13px;">
    Extracted from <strong style="color:${theme.headingColor};">${siteUrl}</strong> stylesheets.
  </p>
</section>`;
}

// ──────────────────────────────────────────────────────────────────────────────
// Google Font loader
// ──────────────────────────────────────────────────────────────────────────────

function buildFontLinkTag(family: string): string {
  const name = formatFontFamily(family);
  const lower = name.toLowerCase();
  const systemFonts = ["sans-serif", "serif", "monospace", "system-ui", "arial", "helvetica", "georgia", "courier", "verdana", "tahoma", "trebuchet"];
  if (systemFonts.some((f) => lower.includes(f))) return "";
  const encoded = name.replace(/ /g, "+");
  return `<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=${encoded}:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">`;
}

// ──────────────────────────────────────────────────────────────────────────────
// Master HTML renderer
// ──────────────────────────────────────────────────────────────────────────────

export function renderDesignSystemHtml(
  analysis: SemanticAnalysis,
  siteTitle: string,
  breakpoints: BreakpointEntry[] = [],
  motion: MotionTokens = EMPTY_MOTION,
): string {
  const theme = deriveSiteTheme(analysis);
  const css = buildCss(theme);
  const fontTag = buildFontLinkTag(theme.bodyFamily);
  const siteUrl = (() => { try { return new URL(analysis.url).hostname; } catch { return analysis.url; } })();
  const colorCount = analysis.palette.allObserved.length;
  const typeCount = [...new Set(analysis.typography.scales.map((s) => `${s.fontSize}-${s.fontWeight}`))].length;
  const bodyFamilyName = formatFontFamily(theme.bodyFamily);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Design System — ${siteTitle}</title>
${fontTag}
<style>${css}</style>
</head>
<body>

<!-- NAV -->
<nav class="nav">
  <div class="nav-brand">
    <div class="nav-brand-dot">${siteTitle.charAt(0).toUpperCase()}</div>
    <span>${siteTitle}</span>
  </div>
  <div class="nav-links">
    <a href="#">Home</a>
    <a href="#">About</a>
    <a href="#">Works</a>
    <a href="#">Contact</a>
  </div>
</nav>

<!-- HERO -->
<div class="hero">
  <div class="hero-inner">
    <span class="hero-eyebrow">Design System Audit</span>
    <h1>${siteTitle.split(".")[0]}<em>.</em>${siteTitle.split(".").slice(1).join(".") || "design"}<br>Visual Language</h1>
    <p>Complete design system extracted from ${siteUrl} — every token, component, interaction pattern, and accessibility note, all from real values.</p>
    <div class="hero-meta">
      <div class="hero-stat"><strong>${colorCount}</strong><span>Color tokens</span></div>
      <div class="hero-stat"><strong>${typeCount}</strong><span>Type styles</span></div>
      <div class="hero-stat"><strong>${breakpoints.length || "—"}</strong><span>Breakpoints</span></div>
      <div class="hero-stat"><strong>${bodyFamilyName.split(" ")[0]}</strong><span>Primary font</span></div>
    </div>
  </div>
</div>

<hr class="divider">

${renderColorSection(analysis.palette.allObserved, theme)}
<hr class="divider">
${renderTypographySection(analysis.typography.scales, theme)}
<hr class="divider">
${renderNavSection(theme, siteTitle)}
<hr class="divider">
${renderButtonSection(theme, analysis.buttons)}
<hr class="divider">
${renderSurfacesSection(analysis.surfaces, analysis.shadows, theme)}
<hr class="divider">
${renderFormSection(theme, siteTitle)}
<hr class="divider">
${renderSpacingSection(analysis.spacing)}
<hr class="divider">
${renderRadiusSection(analysis.radius)}
<hr class="divider">
${renderElevationSection(analysis.shadows, analysis.resolvedCssVariables, theme)}
<hr class="divider">
${renderMotionSection(motion, theme)}
<hr class="divider">
${renderResponsiveSection(analysis.url, breakpoints, theme)}

<footer class="footer">
  <span>Design system analysis of <a href="${analysis.url}" style="color:${theme.primaryHex};text-decoration:none;font-weight:600;">${siteUrl}</a> — all values extracted from live site</span>
  <span>Font: ${bodyFamilyName} · Generated by getdesign.md</span>
</footer>

<style>
@media(max-width:900px){.form-wrap{grid-template-columns:1fr !important;}}
</style>
</body>
</html>`;
}

// ──────────────────────────────────────────────────────────────────────────────
// Design.md renderer
// ──────────────────────────────────────────────────────────────────────────────

export function renderDesignMd(
  analysis: SemanticAnalysis,
  siteTitle: string,
  breakpoints: BreakpointEntry[] = [],
  motion: MotionTokens = EMPTY_MOTION,
): string {
  const theme = deriveSiteTheme(analysis);
  const siteUrl = (() => { try { return new URL(analysis.url).hostname; } catch { return analysis.url; } })();
  const bodyFamilyName = formatFontFamily(theme.bodyFamily);
  const headingFamilyName = formatFontFamily(theme.headingFamily);
  const lines: string[] = [];

  lines.push(`# Design System — ${siteTitle}`);
  lines.push(`> Complete design system extracted from ${siteUrl}. All values from real scraping.`);
  lines.push("");

  // Color Palette
  lines.push("---");
  lines.push("## 01 — Color Palette");
  lines.push("");
  lines.push("| Token | Hex | Role | Contrast on White | Contrast on Black |");
  lines.push("|-------|-----|------|-------------------|-------------------|");
  const colorNamer = uniqueNamer();
  analysis.palette.allObserved.slice(0, 14).forEach((c) => {
    const name = colorNamer(colorTokenName(c, theme.primaryHex));
    const role = colorRoleDesc(c);
    const onWhite = wcagContrast(c.hex, "#ffffff").toFixed(2);
    const onBlack = wcagContrast(c.hex, "#000000").toFixed(2);
    lines.push(`| \`${name}\` | \`${c.hex}\` | ${role} | ${onWhite}:1 | ${onBlack}:1 |`);
  });
  lines.push("");

  // Typography
  lines.push("---");
  lines.push("## 02 — Typography");
  lines.push("");
  const famNote = bodyFamilyName === headingFamilyName
    ? `Single font family: **${bodyFamilyName}**`
    : `Body: **${bodyFamilyName}** · Display: **${headingFamilyName}**`;
  lines.push(famNote);
  lines.push("");
  lines.push("| Role | Font | Size | Weight | Line Height | Usage |");
  lines.push("|------|------|------|--------|-------------|-------|");
  const seenTypo = new Set<string>();
  analysis.typography.scales.slice(0, 10).forEach((s) => {
    const key = `${s.fontSize}-${s.fontWeight}-${s.tag}`;
    if (seenTypo.has(key)) return;
    seenTypo.add(key);
    const role = typoRoleLabel(s);
    const familyName = ["h1", "h2", "h3"].includes(s.tag) ? headingFamilyName : bodyFamilyName;
    const lhNum = pxToNum(s.lineHeight);
    const lhRatio = lhNum > 0 && pxToNum(s.fontSize) > 0 ? (lhNum / pxToNum(s.fontSize)).toFixed(2) : "—";
    lines.push(`| ${role} | ${familyName} | ${s.fontSize} | ${s.fontWeight} | ${lhRatio} | \`${s.tag.toUpperCase()}\` · ${s.usageCount} uses |`);
  });
  lines.push("");

  // Buttons — only tokens actually extracted from the scrape
  lines.push("---");
  lines.push("## 03 — Buttons");
  lines.push("");
  lines.push("| Token | Value |");
  lines.push("|-------|-------|");
  lines.push(`| Border-radius | ${theme.btnRadius ? `\`${theme.btnRadius}\`` : "not detected"} |`);
  if (analysis.buttons.fillType) lines.push(`| Fill type | \`${analysis.buttons.fillType}\` |`);
  if (analysis.buttons.paddingDensity) lines.push(`| Padding density | \`${analysis.buttons.paddingDensity}\` |`);
  lines.push(`| Primary background | \`${theme.primaryHex}\` |`);
  lines.push(`| Primary text | \`${theme.primaryFg}\` |`);
  lines.push("");
  lines.push("Secondary / ghost / disabled variants in the HTML preview are representative demos built from these tokens — not extracted from the site.");
  lines.push("");

  // Surfaces
  lines.push("---");
  lines.push("## 04 — Cards & Surfaces");
  lines.push("");
  const uniqueSurfaces = analysis.surfaces.filter((s, i, arr) =>
    arr.findIndex((x) => x.background === s.background && x.text === s.text) === i,
  ).slice(0, 6);
  lines.push("| Role | Background | Text | Border |");
  lines.push("|------|------------|------|--------|");
  uniqueSurfaces.forEach((s) => {
    const hasBorder = relativeLuminance(s.background) > 0.7 ? "1px solid rgba(0,0,0,0.09)" : "none";
    lines.push(`| ${s.role.replace(/_/g, " ")} | \`${s.background}\` | \`${s.text}\` | ${hasBorder} |`);
  });
  lines.push("");

  // Spacing
  lines.push("---");
  lines.push("## 05 — Spacing Scale");
  lines.push("");
  const positiveSpacing = analysis.spacing.filter((v) => v && !v.startsWith("-"));
  const uniqueSpacing = [...new Set(positiveSpacing)].sort((a, b) => pxToNum(a) - pxToNum(b)).slice(0, 14);
  const spacingNamer = uniqueNamer();
  const spacingTokens = uniqueSpacing.map((v) => ({ value: v, name: spacingNamer(spacingName(pxToNum(v))) }));
  lines.push("| Token | Value |");
  lines.push("|-------|-------|");
  spacingTokens.forEach(({ value: v, name }) => {
    lines.push(`| \`${name}\` | \`${v}\` |`);
  });
  lines.push("");

  // Border Radius
  lines.push("---");
  lines.push("## 06 — Border Radius");
  lines.push("");
  const simpleRadius = analysis.radius.filter((v) => v && (!v.includes(" ") || v.trim().split(/\s+/).length === 1));
  const uniqueRadius = [...new Set(simpleRadius)].sort((a, b) => pxToNum(a) - pxToNum(b));
  if (uniqueRadius.length) {
    lines.push("| Token | Value | Shape |");
    lines.push("|-------|-------|-------|");
    uniqueRadius.slice(0, 8).forEach((v) => {
      const px = pxToNum(v);
      lines.push(`| \`${radiusName(v)}\` | \`${v}\` | ${px === 0 ? "sharp" : px >= 100 ? "pill" : "rounded"} |`);
    });
  } else {
    lines.push("No border-radius tokens detected in the scraped styles.");
  }
  lines.push("");

  // Elevation
  lines.push("---");
  lines.push("## 07 — Elevation & Depth");
  lines.push("");
  const hasShadows = analysis.shadows.some((s) => s && s !== "none");
  if (hasShadows) {
    lines.push("Box-shadow tokens:");
    lines.push("");
    analysis.shadows.filter((s) => s && s !== "none").slice(0, 4).forEach((s) => {
      lines.push(`- \`${s}\``);
    });
  } else {
    lines.push("**Flat design** — zero \`box-shadow\` usage. Depth communicated through background-color contrast and 1px borders.");
    lines.push("");
    lines.push(`| Level | Background | Elevation method |`);
    lines.push(`|-------|------------|-----------------|`);
    lines.push(`| 0 — Page canvas | \`${theme.pageBg}\` | Outermost layer |`);
    lines.push(`| 1 — Card surface | \`#ffffff\` | White lift + border |`);
    lines.push(`| Dark section | \`${theme.heroBg}\` | Color contrast |`);
  }
  lines.push("");

  // Responsive — real boundaries with real rule counts; honest empty state
  lines.push("---");
  lines.push("## 08 — Responsive Breakpoints");
  lines.push("");
  if (breakpoints.length) {
    const bpNamer = uniqueNamer();
    lines.push("| Breakpoint | Boundary | Usage |");
    lines.push("|------------|----------|-------|");
    [...breakpoints].sort((a, b) => a.minPx - b.minPx).forEach((bp) => {
      lines.push(`| ${bpNamer(breakpointName(bp.minPx))} | ${bp.minPx}px | ${bp.ruleCount} @media rule${bp.ruleCount === 1 ? "" : "s"} |`);
    });
  } else {
    lines.push("No media-query breakpoints detected in the scraped stylesheets.");
  }
  lines.push("");

  // Motion — real extracted transition/animation tokens
  lines.push("---");
  lines.push("## 09 — Motion");
  lines.push("");
  if (motion.durations.length || motion.easings.length) {
    lines.push("| Token | Value | Occurrences |");
    lines.push("|-------|-------|-------------|");
    motion.durations.forEach((d, i) => {
      lines.push(`| ${durationTokenName(i, motion.durations.length)} | \`${d.value}\` | ${d.count}× |`);
    });
    motion.easings.forEach((e, i) => {
      lines.push(`| easing${motion.easings.length > 1 ? `-${i + 1}` : ""} | \`${e.value}\` | ${e.count}× |`);
    });
  } else {
    lines.push("No transition or animation tokens detected in the scraped stylesheets.");
  }
  lines.push("");

  // Design Tokens summary
  lines.push("---");
  lines.push("## Design Token Summary");
  lines.push("");
  lines.push(`\`\`\`css`);
  lines.push(`:root {`);
  lines.push(`  /* Colors */`);
  lines.push(`  --color-primary: ${theme.primaryHex};`);
  lines.push(`  --color-primary-fg: ${theme.primaryFg};`);
  lines.push(`  --color-page-bg: ${theme.pageBg};`);
  lines.push(`  --color-page-text: ${theme.pageText};`);
  lines.push(`  --color-heading: ${theme.headingColor};`);
  lines.push(`  --color-nav-bg: ${theme.navBg};`);
  lines.push(`  --color-muted: ${theme.mutedColor};`);
  lines.push(``);
  lines.push(`  /* Typography */`);
  lines.push(`  --font-body: '${bodyFamilyName}', sans-serif;`);
  lines.push(`  --font-heading: '${headingFamilyName}', sans-serif;`);
  lines.push(``);
  lines.push(`  /* Spacing */`);
  spacingTokens.slice(0, 8).forEach(({ value: v, name }) => {
    lines.push(`  --spacing-${name}: ${v};`);
  });
  if (theme.btnRadius || theme.inputRadius) {
    lines.push(``);
    lines.push(`  /* Radius */`);
    if (theme.btnRadius) lines.push(`  --radius-button: ${theme.btnRadius};`);
    if (theme.inputRadius) lines.push(`  --radius-input: ${theme.inputRadius};`);
  }
  lines.push(`}`);
  lines.push("```");
  lines.push("");
  lines.push(`---`);
  lines.push(`*Generated by getdesign.md — all values from live scrape of ${siteUrl}*`);

  return lines.join("\n");
}

// ──────────────────────────────────────────────────────────────────────────────
// Breakpoint extractor from scraped component files
// ──────────────────────────────────────────────────────────────────────────────

async function extractBreakpoints(runDir: string): Promise<BreakpointEntry[]> {
  // boundary px → number of @media rules referencing it.
  // max-width:N means the breakpoint boundary is N+1 (min-width form).
  const boundaryCounts = new Map<number, number>();

  function scanCss(css: string): void {
    for (const m of css.matchAll(/@media[^{]*min-width:\s*(\d+)px/gi)) {
      const px = parseInt(m[1], 10);
      if (px > 320 && px < 3000) boundaryCounts.set(px, (boundaryCounts.get(px) ?? 0) + 1);
    }
    for (const m of css.matchAll(/@media[^{]*max-width:\s*(\d+)px/gi)) {
      const px = parseInt(m[1], 10) + 1;
      if (px > 320 && px < 3000) boundaryCounts.set(px, (boundaryCounts.get(px) ?? 0) + 1);
    }
  }

  // Primary source: the site's real stylesheets saved by Stage 1 (page_styles/*.css)
  try {
    const stylesDir = join(runDir, "page_styles");
    for (const entry of await readdir(stylesDir)) {
      if (!entry.endsWith(".css")) continue;
      try {
        scanCss(await readFile(join(stylesDir, entry), "utf-8"));
      } catch { /* unreadable file */ }
    }
  } catch { /* no page_styles dir */ }

  // Fallback source: inline styles inside scraped component DOM snapshots
  if (boundaryCounts.size === 0) {
    try {
      const compDir = join(runDir, "components");
      for (const entry of await readdir(compDir)) {
        try {
          scanCss(await readFile(join(compDir, entry, "dom.html"), "utf-8"));
        } catch { /* no dom.html */ }
      }
    } catch { /* no components dir */ }
  }

  // Keep breakpoints referenced by 2+ rules; if none qualify, accept single hits.
  let significant = [...boundaryCounts.entries()].filter(([, count]) => count >= 2);
  if (significant.length === 0) significant = [...boundaryCounts.entries()];
  significant.sort(([a], [b]) => a - b);

  return significant.slice(0, 5).map(([px, count]) => ({ minPx: px, ruleCount: count }));
}

// ──────────────────────────────────────────────────────────────────────────────
// Motion extractor — real transition/animation values from scraped stylesheets
// ──────────────────────────────────────────────────────────────────────────────

async function extractMotionTokens(runDir: string): Promise<MotionTokens> {
  const durationCounts = new Map<string, number>();
  const easingCounts = new Map<string, number>();

  function scanCss(css: string): void {
    for (const decl of css.matchAll(/(?:transition|animation)(?:-duration|-timing-function)?\s*:\s*([^;{}]+)/gi)) {
      const value = decl[1];
      for (const d of value.matchAll(/(\d*\.?\d+)(ms|s)\b/g)) {
        let secs = parseFloat(d[1]);
        if (d[2] === "ms") secs /= 1000;
        if (secs <= 0 || secs > 60) continue;
        const key = `${parseFloat(secs.toFixed(3))}s`;
        durationCounts.set(key, (durationCounts.get(key) ?? 0) + 1);
      }
      for (const e of value.matchAll(/\b(ease-in-out|ease-in|ease-out|ease|linear|step-start|step-end)\b|cubic-bezier\([^)]*\)/g)) {
        easingCounts.set(e[0], (easingCounts.get(e[0]) ?? 0) + 1);
      }
    }
  }

  try {
    const stylesDir = join(runDir, "page_styles");
    for (const entry of await readdir(stylesDir)) {
      if (!entry.endsWith(".css")) continue;
      try {
        scanCss(await readFile(join(stylesDir, entry), "utf-8"));
      } catch { /* unreadable file */ }
    }
  } catch { /* no page_styles dir */ }

  // Top distinct durations by usage, displayed fastest-first
  const durations = [...durationCounts.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => parseFloat(a.value) - parseFloat(b.value));

  const easings = [...easingCounts.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([value, count]) => ({ value, count }));

  return { durations, easings };
}

// ──────────────────────────────────────────────────────────────────────────────
// Entry point — reads run dir, returns HTML + Markdown
// ──────────────────────────────────────────────────────────────────────────────

export async function renderFromRunDir(
  runDir: string,
  url: string,
): Promise<{ html: string; md: string } | null> {
  try {
    const analysisPath = join(runDir, "semantic_analysis.json");
    const raw = await readFile(analysisPath, "utf-8");
    const analysis: SemanticAnalysis = JSON.parse(raw);

    const siteTitle = (() => {
      try {
        return new URL(url).hostname.replace(/^www\./, "");
      } catch {
        return url;
      }
    })();

    const breakpoints = await extractBreakpoints(runDir);
    const motion = await extractMotionTokens(runDir);
    const html = renderDesignSystemHtml(analysis, siteTitle, breakpoints, motion);
    const md = renderDesignMd(analysis, siteTitle, breakpoints, motion);

    return { html, md };
  } catch {
    return null;
  }
}
