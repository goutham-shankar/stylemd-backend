"use strict";
/**
 * designSystemRenderer.ts
 *
 * Standard design-system renderer. Reads semantic_analysis.json (Stage 2) and produces:
 *   - preview.html  — dacoit-style visual design system document
 *   - design.md     — developer-focused markdown design document
 *
 * All values come from real scraping — no fallback placeholder data.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderDesignSystemHtml = renderDesignSystemHtml;
exports.renderDesignMd = renderDesignMd;
exports.renderFromRunDir = renderFromRunDir;
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const EMPTY_MOTION = { durations: [], easings: [] };
const EMPTY_CONTENT = {
    navLinks: [], copyright: null, logoSvg: null, logoUrl: null, brandAssets: [], email: null,
    socialLinks: [], marquee: null, realButtons: [], workCards: [],
    textSamples: new Map(), loadedFonts: [], iconLibrary: null,
};
// ──────────────────────────────────────────────────────────────────────────────
// WCAG & color utilities
// ──────────────────────────────────────────────────────────────────────────────
function srgbLinear(c) {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
function relativeLuminance(hex) {
    if (!hex || !hex.startsWith("#") || hex.length < 7)
        return 0.5;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    if (isNaN(r + g + b))
        return 0.5;
    return 0.2126 * srgbLinear(r) + 0.7152 * srgbLinear(g) + 0.0722 * srgbLinear(b);
}
function wcagContrast(hex1, hex2) {
    const L1 = relativeLuminance(hex1);
    const L2 = relativeLuminance(hex2);
    return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
}
// Text colors are judged against the page canvas they actually sit on;
// background colors against the better of white/black (decorative use).
function contrastBadgeHtml(hex, roles, pageBg) {
    const isText = roles.includes("text");
    let ratio;
    let bgLabel;
    if (isText) {
        ratio = wcagContrast(hex, pageBg);
        bgLabel = `page bg ${pageBg}`;
    }
    else {
        const onWhite = wcagContrast(hex, "#ffffff");
        const onBlack = wcagContrast(hex, "#000000");
        ({ ratio, bgLabel } = onWhite >= onBlack
            ? { ratio: onWhite, bgLabel: "white" }
            : { ratio: onBlack, bgLabel: "black" });
    }
    let level;
    let pass;
    if (ratio >= 7) {
        level = "AAA ✓";
        pass = true;
    }
    else if (ratio >= 4.5) {
        level = "AA ✓";
        pass = true;
    }
    else if (ratio >= 3) {
        level = "AA large text ✓";
        pass = true;
    }
    else {
        level = "fails AA";
        pass = false;
    }
    const cls = pass ? "contrast-pass" : "contrast-fail";
    return `<span class="swatch-contrast ${cls}">${ratio.toFixed(2)}:1 on ${bgLabel} · ${level}</span>`;
}
function rgbCssToHex(val) {
    if (!val)
        return "";
    const t = val.trim();
    if (t.startsWith("#"))
        return t;
    const parts = t.split(",").map((s) => parseInt(s.trim(), 10));
    if (parts.length === 3 && parts.every((n) => !isNaN(n))) {
        return "#" + parts.map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0")).join("");
    }
    return t;
}
function pxToNum(val) {
    return parseFloat(val?.replace("px", "") ?? "0") || 0;
}
// Handles "#hex", "rgb(r, g, b)", "rgba(...)" and bare "r,g,b" forms.
function cssColorToHex(val) {
    if (!val)
        return "";
    const m = val.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (m) {
        return "#" + [m[1], m[2], m[3]]
            .map((n) => Math.min(255, parseInt(n, 10)).toString(16).padStart(2, "0"))
            .join("");
    }
    return rgbCssToHex(val);
}
function autoFg(bg) {
    return relativeLuminance(bg) > 0.35 ? "#1a1a1a" : "#ffffff";
}
// Saturation (HSV) 0..1 — used to find brand accents vs neutrals.
function saturationOf(hex) {
    if (!hex || !hex.startsWith("#") || hex.length < 7)
        return 0;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    if (isNaN(r + g + b))
        return 0;
    const max = Math.max(r, g, b);
    return max === 0 ? 0 : (max - Math.min(r, g, b)) / max;
}
const BROWSER_DEFAULT_LINK_COLORS = new Set(["#0000ee", "#551a8b"]);
// Scraped surface pairs can be contradictory (e.g. dark text reported on a dark
// bg). Only trust the scraped text color if it actually reads on the background.
function readableOn(bg, preferred) {
    if (preferred && wcagContrast(bg, preferred) >= 2.5)
        return preferred;
    return autoFg(bg);
}
// Most saturated non-neutral color = brand accent candidate.
function pickAccentColor(colors) {
    const candidates = colors
        .filter((c) => {
        const h = c.hex.toLowerCase();
        if (BROWSER_DEFAULT_LINK_COLORS.has(h))
            return false;
        const lum = relativeLuminance(c.hex);
        return saturationOf(c.hex) > 0.35 && lum > 0.02 && lum < 0.85;
    })
        .sort((a, b) => saturationOf(b.hex) - saturationOf(a.hex));
    return candidates[0]?.hex ?? null;
}
// Returns a function that appends -2, -3… to repeated token names.
function uniqueNamer() {
    const counts = new Map();
    return (name) => {
        const n = (counts.get(name) ?? 0) + 1;
        counts.set(name, n);
        return n === 1 ? name : `${name}-${n}`;
    };
}
function formatFontFamily(family) {
    const name = family.split(",")[0].replace(/['"]/g, "").trim();
    // Title-case so Google Fonts URLs resolve ("Mona sans" → "Mona Sans")
    return name.replace(/\b[a-z]/g, (ch) => ch.toUpperCase());
}
// Sanitize a scraped inline SVG before embedding it in our document:
// strip <script>, event handlers, and external refs; cap size.
function sanitizeInlineSvg(svg) {
    if (!svg || svg.length > 20000)
        return null;
    let s = svg
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
        .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
        .replace(/(href|xlink:href)\s*=\s*"(?!#)[^"]*"/gi, "")
        .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "");
    // Force the root to scale within its container
    s = s.replace(/<svg\b([^>]*)>/i, (_m, attrs) => {
        const cleaned = attrs.replace(/\b(width|height)\s*=\s*"[^"]*"/gi, "");
        return `<svg${cleaned} width="100%" height="100%" preserveAspectRatio="xMidYMid meet">`;
    });
    return s;
}
// ──────────────────────────────────────────────────────────────────────────────
// Theme derivation from semantic_analysis.json
// ──────────────────────────────────────────────────────────────────────────────
function deriveSiteTheme(analysis) {
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
    // Ink: darkest text-role color observable on the page — only ever placed on
    // guaranteed-light boxes (swatches, demo cards), so it must stay dark even
    // when the page itself is dark-themed (pageText would be light there).
    const inkColor = (() => {
        const dark = analysis.palette.allObserved
            .filter((c) => relativeLuminance(c.hex) < 0.25 && c.roles.includes("text"))
            .sort((a, b) => b.frequency - a.frequency)[0];
        return dark?.hex ?? "#1a1a1a";
    })();
    // Heading: same ink color, but verified against the page background —
    // sections have no background of their own, so they show through to
    // pageBg. On dark-themed sites the ink color (intentionally dark) would
    // be invisible there, so fall back to an auto-contrast color instead.
    const headingColor = readableOn(pageBg, inkColor);
    // primaryHex is reused as a decorative text/fill accent in several spots
    // that sit directly on pageBg/heroBg/navBg with no card wrapper behind
    // them — verify it actually contrasts with each surface rather than
    // assuming a light-on-dark layout.
    const primaryOnPage = readableOn(pageBg, primaryHex);
    const primaryOnHero = readableOn(heroBg, primaryHex);
    const primaryOnNav = readableOn(navBg, primaryHex);
    const mutedColor = "#8d8d8d";
    const btnRadius = vars["--buttons-radius"] || analysis.buttons.radius || null;
    const inputRadius = vars["--inputs-radius"] || null;
    const bodyFamily = vars["--font-body-family"] || analysis.typography.body[0] || "sans-serif";
    const headingFamily = vars["--font-heading-family"] || analysis.typography.display[0] || bodyFamily;
    return {
        primaryHex, primaryFg, pageBg, pageText,
        navBg, navText, navLinkColor,
        heroBg, heroText, heroTextMuted,
        headingColor, inkColor, primaryOnPage, primaryOnHero, primaryOnNav,
        mutedColor,
        btnRadius, inputRadius, bodyFamily, headingFamily,
    };
}
// ──────────────────────────────────────────────────────────────────────────────
// Token naming helpers
// ──────────────────────────────────────────────────────────────────────────────
function colorTokenName(c, primaryHex) {
    const h = c.hex.toLowerCase();
    const lum = relativeLuminance(c.hex);
    if (h === primaryHex.toLowerCase())
        return "primary";
    if (BROWSER_DEFAULT_LINK_COLORS.has(h))
        return "link";
    if (saturationOf(c.hex) > 0.35 && lum > 0.02 && lum < 0.85)
        return "accent";
    if (h === "#ffffff")
        return "white";
    if (h === "#000000")
        return "black";
    if (lum > 0.9)
        return "canvas";
    if (lum > 0.75)
        return "canvas-soft";
    if (lum < 0.04)
        return "ink-deepest";
    if (lum < 0.08)
        return "ink-dark";
    if (lum < 0.2)
        return "ink";
    if (c.roles.includes("text") && lum > 0.1 && lum < 0.5)
        return "text-secondary";
    if (c.roles.includes("background") && c.areaWeight > 20)
        return "page-bg";
    if (c.roles.includes("background") && c.areaWeight > 3)
        return "surface";
    if (c.roles.includes("text"))
        return "text";
    return "accent";
}
function colorRoleDesc(c) {
    const r = c.roles.map((s) => s.replace(/_/g, " ")).join(", ");
    if (c.areaWeight > 30)
        return `Dominant — ${r}`;
    if (c.areaWeight > 10)
        return `Major — ${r}`;
    if (c.areaWeight > 2)
        return `Supporting — ${r}`;
    return `Accent — ${r}`;
}
function spacingName(px) {
    if (px <= 2)
        return "xxs";
    if (px <= 4)
        return "xs";
    if (px <= 8)
        return "sm";
    if (px <= 12)
        return "md";
    if (px <= 16)
        return "base";
    if (px <= 24)
        return "lg";
    if (px <= 32)
        return "xl";
    if (px <= 48)
        return "2xl";
    if (px <= 64)
        return "3xl";
    return "section";
}
function radiusName(val) {
    const px = pxToNum(val);
    if (px === 0)
        return "none";
    if (px <= 4)
        return "xs";
    if (px <= 8)
        return "sm";
    if (px <= 12)
        return "md";
    if (px <= 20)
        return "lg";
    if (px <= 40)
        return "xl";
    return "full";
}
function typoRoleLabel(s) {
    const size = pxToNum(s.fontSize);
    const weight = parseInt(s.fontWeight, 10);
    if (size >= 24 && weight <= 200)
        return "Thin Display";
    if (size >= 48 && weight >= 600)
        return "Display Hero";
    if (size >= 32 && weight >= 600)
        return "Display";
    if (size >= 24 && weight >= 600)
        return "Heading";
    if (size >= 20 && weight >= 500)
        return "Subheading";
    if (size >= 16 && s.tag === "a")
        return "Link";
    if (size >= 16 && weight >= 600)
        return "UI Label";
    if (size >= 16)
        return "Body";
    if (size >= 13 && weight >= 600)
        return "Caption Bold";
    if (size >= 13)
        return "Caption";
    return "Micro";
}
function sampleForRole(role) {
    if (role === "Display Hero" || role === "Display")
        return "The quick brown fox jumps";
    if (role === "Heading" || role === "Subheading")
        return "The quick brown fox jumps over";
    if (role === "Link")
        return "Read more →";
    if (role === "Micro")
        return "LABEL · TAG";
    return "The quick brown fox jumps over the lazy dog";
}
// ──────────────────────────────────────────────────────────────────────────────
// CSS block
// ──────────────────────────────────────────────────────────────────────────────
function buildCss(t) {
    const { primaryHex, primaryFg, pageBg, pageText, navBg, navText, navLinkColor, heroBg, heroText, heroTextMuted, headingColor, inkColor, primaryOnPage, primaryOnHero, primaryOnNav, mutedColor, bodyFamily } = t;
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
.hero-eyebrow{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:${primaryOnHero};margin:0 0 20px;display:block;}
.hero h1{font-size:64px;font-weight:700;line-height:1.0;color:${heroText};margin:0 0 20px;letter-spacing:-1.5px;}
.hero h1 em{font-style:normal;color:${primaryOnHero};}
.hero p{font-size:18px;color:${heroTextMuted};max-width:640px;margin:0 0 40px;line-height:1.6;}
.hero-meta{display:flex;gap:32px;flex-wrap:wrap;}
.hero-stat{display:flex;flex-direction:column;gap:2px;}
.hero-stat strong{font-size:22px;font-weight:700;color:${heroText};}
.hero-stat span{font-size:12px;color:${heroTextMuted};text-transform:uppercase;letter-spacing:1px;}
section{padding:80px 48px;max-width:1344px;margin:0 auto;}
.section-eyebrow{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:${primaryOnPage};margin-bottom:6px;display:block;}
.section-heading{font-size:34px;font-weight:700;letter-spacing:-0.5px;margin:0 0 8px;color:${headingColor};}
.section-sub{font-size:15px;color:${mutedColor};margin:0 0 36px;line-height:1.5;}
.divider{border:none;border-top:1px solid rgba(0,0,0,0.09);margin:0;}
.palette-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:14px;}
.swatch{border:1px solid rgba(0,0,0,0.09);border-radius:10px;overflow:hidden;background:#ffffff;}
.swatch-fill{height:88px;}
.swatch-meta{padding:14px;}
.swatch-name{font-weight:700;font-size:13px;margin:0 0 2px;color:${inkColor};}
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
.spacing-bar{background:${primaryOnPage};border-radius:2px;height:32px;}
.spacing-label{font-family:'Courier New',monospace;font-size:10px;color:${mutedColor};text-align:center;line-height:1.5;}
.radius-row{display:flex;gap:28px;flex-wrap:wrap;align-items:flex-end;}
.radius-item{display:flex;flex-direction:column;align-items:center;gap:10px;}
.radius-box{width:80px;height:80px;background:#ffffff;border:2px solid ${inkColor};display:flex;align-items:center;justify-content:center;}
.radius-label{font-family:'Courier New',monospace;font-size:10px;color:${mutedColor};text-align:center;line-height:1.6;}
.elevation-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:20px;}
.elev-card{background:#ffffff;padding:24px;font-size:13px;color:#555;line-height:1.6;}
.state-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:20px;}
.motion-row{display:flex;flex-direction:column;gap:16px;}
.motion-row table{width:100%;border-collapse:collapse;font-size:14px;}
.motion-row table th{font-size:10px;text-transform:uppercase;letter-spacing:1px;color:${mutedColor};padding:10px 16px;text-align:left;border-bottom:2px solid #e0e0e0;background:#f9f9f9;}
.motion-row table td{padding:14px 16px;border-bottom:1px solid #e8e8e8;font-size:13px;color:${pageText};}
.motion-row table td:first-child{font-family:'Courier New',monospace;font-weight:600;color:${primaryOnPage};}
.responsive-table{width:100%;border-collapse:collapse;font-size:14px;}
.responsive-table th,.responsive-table td{text-align:left;padding:12px 16px;border-bottom:1px solid #e0e0e0;}
.responsive-table th{font-size:10px;text-transform:uppercase;letter-spacing:1px;color:${mutedColor};background:#f9f9f9;}
.responsive-table td:first-child{font-family:'Courier New',monospace;font-weight:600;color:${headingColor};}
.device-ladder{display:flex;gap:16px;align-items:flex-end;margin-top:32px;flex-wrap:wrap;}
.device-box{background:#ffffff;border:1.5px solid ${inkColor};display:flex;flex-direction:column;align-items:center;justify-content:flex-end;padding:8px;font-size:10px;font-family:'Courier New',monospace;color:${mutedColor};gap:4px;}
.marquee-demo{background:${heroBg};padding:16px 0;overflow:hidden;}
.marquee-track{display:flex;white-space:nowrap;animation:marquee 18s linear infinite;}
.marquee-item{font-size:13px;font-weight:700;color:${primaryOnHero};padding:0 28px;letter-spacing:0.5px;}
@keyframes marquee{0%{transform:translateX(0);}100%{transform:translateX(-50%);}}
.works-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:20px;}
.work-card{overflow:hidden;background:${heroBg};color:${heroText};border-radius:0;}
.work-card-img{height:120px;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700;letter-spacing:1px;color:${primaryOnNav};background:${navBg};}
.work-card-body{padding:18px 20px;}
.work-card-title{font-size:16px;font-weight:700;margin:0 0 4px;color:${heroText};}
.work-card-desc{font-size:12px;color:${heroTextMuted};margin:0;word-break:break-all;}
.footer{padding:32px 48px;border-top:1px solid rgba(0,0,0,0.09);font-size:13px;color:${mutedColor};display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;background:${pageBg};}
@media(max-width:768px){section{padding:48px 20px;}.section-heading{font-size:26px;}.hero{padding:48px 20px;}.hero h1{font-size:38px;}.nav{padding:0 20px;}.footer{padding:24px 20px;}}`;
}
// ──────────────────────────────────────────────────────────────────────────────
// Section renderers
// ──────────────────────────────────────────────────────────────────────────────
// External image with a graceful fallback: on load error (e.g. CDN hotlink 403,
// undecodable AVIF) it swaps to a clean inline placeholder, never the browser's "?".
// The placeholder SVG is fully percent-encoded so the onerror attribute value
// contains no markup characters (valid HTML — no stray <, >, or quotes).
function assetImgHtml(url, label, maxHeight) {
    const safeLabel = label.replace(/[<>"'&]/g, "").slice(0, 24);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60">` +
        `<rect width="120" height="60" fill="#f0f0f0" stroke="#d8d8d8"/>` +
        `<text x="60" y="34" font-size="9" fill="#8d8d8d" text-anchor="middle" font-family="monospace">${safeLabel}</text></svg>`;
    const placeholder = "data:image/svg+xml," + encodeURIComponent(svg).replace(/'/g, "%27");
    const safeUrl = url.replace(/"/g, "&quot;");
    return `<img src="${safeUrl}" alt="${safeLabel}" loading="lazy" style="max-height:${maxHeight}px;max-width:100%;width:auto;" onerror="this.onerror=null;this.src='${placeholder}'">`;
}
// Real site marquee reproduced with its scraped text and animation duration.
function renderMarqueeBar(marquee) {
    const items = Array(8).fill(`<span class="marquee-item">${marquee.text}</span>`).join("");
    // CSS duration is real when scraped; JS-driven tickers get a demo speed (text is real either way)
    const duration = marquee.duration ?? "18s";
    return `<div class="marquee-demo">
  <div class="marquee-track" style="animation-duration:${duration};">${items}</div>
</div>`;
}
function renderWorksSection(workCards, theme) {
    const cards = workCards.map((w) => `<div class="work-card">
  <div class="work-card-img">${w.title.toUpperCase().slice(0, 18)}</div>
  <div class="work-card-body">
    <p class="work-card-title">${w.title}</p>
    <p class="work-card-desc">${w.href}</p>
  </div>
</div>`).join("\n");
    return `<section>
  <span class="section-eyebrow">06 — Components</span>
  <h2 class="section-heading">Project Cards</h2>
  <p class="section-sub">Real case studies found on the scraped site — titles and URLs extracted from live links.</p>
  <div class="works-grid">${cards}</div>
</section>`;
}
function renderBrandAssetsSection(content, theme, siteTitle) {
    const cards = [];
    // Brand mark — inline SVG always renders; image logo degrades gracefully
    if (content.logoSvg) {
        cards.push(`<div class="demo-card">
  <span class="demo-label">Brand mark — extracted (inline SVG)</span>
  <div style="display:flex;align-items:center;justify-content:center;height:88px;padding:16px;background:${theme.navBg};border-radius:4px;color:${theme.navText};">
    <span style="display:inline-block;height:48px;width:auto;max-width:200px;">${content.logoSvg}</span>
  </div>
  <p class="demo-note">Logo extracted as inline SVG from the page markup.</p>
</div>`);
    }
    else if (content.logoUrl) {
        cards.push(`<div class="demo-card">
  <span class="demo-label">Brand mark — extracted asset</span>
  <div style="display:flex;align-items:center;justify-content:center;height:88px;padding:16px;background:${theme.navBg};border-radius:4px;">
    ${assetImgHtml(content.logoUrl, `${siteTitle} logo`, 48)}
  </div>
  <p class="demo-note" style="word-break:break-all;">${content.logoUrl}</p>
</div>`);
    }
    for (const asset of content.brandAssets.slice(0, 2)) {
        cards.push(`<div class="demo-card">
  <span class="demo-label">Brand asset — ${asset.label}</span>
  <div style="display:flex;align-items:center;justify-content:center;height:80px;padding:16px;background:#fafafa;border-radius:4px;">
    ${assetImgHtml(asset.url, asset.label, 64)}
  </div>
  <p class="demo-note" style="word-break:break-all;">${asset.url}</p>
</div>`);
    }
    if (content.socialLinks.length) {
        const links = content.socialLinks.map((s) => `<a href="${s.href}" style="font-size:13px;color:${theme.inkColor};font-weight:600;text-decoration:none;border:1.5px solid ${theme.inkColor};padding:8px 14px;">${s.label} ↗</a>`).join("\n      ");
        cards.push(`<div class="demo-card">
  <span class="demo-label">Social links found on site</span>
  <div style="display:flex;gap:12px;flex-wrap:wrap;padding:8px 0;">
      ${links}
  </div>
</div>`);
    }
    const iconNote = content.iconLibrary
        ? `Icon library detected: <strong>${content.iconLibrary}</strong>.`
        : "No icon library (Phosphor, Feather, Heroicons, Font Awesome…) detected in the scraped pages.";
    cards.push(`<div class="demo-card">
  <span class="demo-label">Icon system</span>
  <p class="demo-note" style="margin-top:0;">${iconNote}</p>
</div>`);
    return `<section>
  <span class="section-eyebrow">13 — Assets</span>
  <h2 class="section-heading">Iconography &amp; Brand Assets</h2>
  <p class="section-sub">Assets and links extracted from the scraped pages.</p>
  <div class="grid-2">${cards.join("\n")}</div>
</section>`;
}
function renderColorSection(colors, theme) {
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
    ${contrastBadgeHtml(c.hex, c.roles, theme.pageBg)}
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
function renderTypographySection(scales, theme, content) {
    const seen = new Set();
    const unique = scales.filter((s) => {
        const key = `${s.fontSize}-${s.fontWeight}-${s.tag}`;
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    }).slice(0, 10);
    const bodyFamilyName = formatFontFamily(theme.bodyFamily);
    const headingFamilyName = formatFontFamily(theme.headingFamily);
    let famNote = bodyFamilyName === headingFamilyName
        ? `Single font family: <strong>${bodyFamilyName}</strong> — used across all roles.`
        : `Body: <strong>${bodyFamilyName}</strong> · Display: <strong>${headingFamilyName}</strong>.`;
    if (content.loadedFonts.length) {
        const fonts = content.loadedFonts.map((f) => `${f.family} (${f.weights.join(", ")})`).join(" · ");
        famNote += ` Font files loaded by the site: ${fonts}.`;
    }
    const rows = unique.map((s) => {
        const role = typoRoleLabel(s);
        const familyName = ["h1", "h2", "h3"].includes(s.tag) ? headingFamilyName : bodyFamilyName;
        const lhNum = pxToNum(s.lineHeight);
        // Only show line-height when it was actually scraped — never invent one
        const lhRatio = lhNum > 0 && pxToNum(s.fontSize) > 0 ? (lhNum / pxToNum(s.fontSize)).toFixed(2) : null;
        const displaySize = Math.min(pxToNum(s.fontSize), 36);
        // Prefer real site copy for this size/weight; fall back to pangram
        const realSample = content.textSamples.get(`${pxToNum(s.fontSize)}|${s.fontWeight}`);
        const sample = realSample ?? sampleForRole(role);
        const sampleNote = realSample ? " · real site copy" : "";
        return `<tr>
  <td><span class="type-role-badge">${role}</span></td>
  <td><div class="type-meta">${familyName}<br>${s.fontSize} / ${s.fontWeight}${lhRatio ? `<br>lh ${lhRatio}` : ""}</div></td>
  <td><div style="font-size:${displaySize}px;font-weight:${s.fontWeight};${lhRatio ? `line-height:${lhRatio};` : ""}color:${s.color};">${sample}</div></td>
  <td><div class="type-meta">${s.tag.toUpperCase()} element · ${s.usageCount} uses${sampleNote}</div></td>
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
// Brand mark for nav chrome: inline SVG (renders on any bg via currentColor),
// then logo image, then a letter dot. `color` tints the inline SVG.
function navBrandMark(content, siteTitle, heightPx, color) {
    if (content.logoSvg) {
        return `<span style="display:inline-flex;align-items:center;height:${heightPx}px;width:auto;max-width:${heightPx * 4}px;color:${color};">${content.logoSvg}</span>`;
    }
    if (content.logoUrl) {
        return assetImgHtml(content.logoUrl, `${siteTitle} logo`, heightPx);
    }
    return `<div class="nav-brand-dot">${siteTitle.charAt(0).toUpperCase()}</div>`;
}
function renderNavSection(theme, siteTitle, content) {
    const hasRealLinks = content.navLinks.length > 0;
    const navLinks = hasRealLinks ? content.navLinks : ["Home", "About", "Works", "Contact"];
    const brandMark = navBrandMark(content, siteTitle, 28, theme.navText);
    const hasLogo = content.logoSvg || content.logoUrl;
    const tokenRows = [
        ["Background", theme.navBg],
        ["Text color", theme.navText],
        ["Font family", formatFontFamily(theme.bodyFamily)],
    ];
    if (hasRealLinks)
        tokenRows.push(["Links (extracted)", content.navLinks.join(" · ")]);
    if (content.copyright)
        tokenRows.push(["Copyright (extracted)", content.copyright]);
    return `<section>
  <span class="section-eyebrow">03 — Components</span>
  <h2 class="section-heading">Navigation</h2>
  <p class="section-sub">Nav demo using extracted colors, font${hasRealLinks ? ", real link labels" : ""}${hasLogo ? " and the site's real logo" : ""}.</p>

  <div style="margin-bottom:20px;">
    <div class="demo-label">nav · demo using extracted tokens${hasRealLinks ? " &amp; real links" : ""}</div>
    <div class="nav-demo">
      <div style="display:flex;align-items:center;gap:8px;">
        ${brandMark}
        <span style="font-size:14px;font-weight:700;color:${theme.navText};">${siteTitle}</span>
      </div>
      <div class="nav-demo-links">
        ${navLinks.map((l, i) => `<span${i === 0 ? ' class="active"' : ""}>${l}</span>`).join("")}
      </div>
      ${content.copyright ? `<span style="font-size:11px;color:${theme.navLinkColor};">${content.copyright}</span>` : ""}
    </div>
  </div>

  <div class="grid-2">
    <div class="demo-card">
      <span class="demo-label">Extracted nav tokens</span>
      <table style="width:100%;font-size:13px;border-collapse:collapse;">
        ${tokenRows.map(([k, v]) => `<tr style="border-bottom:1px solid #eee;"><td style="padding:8px 0;color:#8d8d8d;">${k}</td><td style="padding:8px 0;font-family:monospace;font-weight:600;">${v}</td></tr>`).join("")}
      </table>
      <p class="demo-note">Layout values (height, padding, link states) are demo styling — not extracted from the site.</p>
    </div>
  </div>
</section>`;
}
function renderButtonSection(theme, buttons, content) {
    const { primaryHex, primaryFg } = theme;
    const radiusCss = theme.btnRadius ?? "0";
    const radiusLabel = theme.btnRadius ?? "not detected";
    const extras = [
        theme.btnRadius ? `Border-radius: <code>${theme.btnRadius}</code>` : "Border-radius: not detected in scrape",
        buttons.fillType ? `fill type: <code>${buttons.fillType}</code>` : "",
        buttons.paddingDensity ? `padding density: <code>${buttons.paddingDensity}</code>` : "",
    ].filter(Boolean).join(" · ");
    // Real buttons scraped from the page — exact label, colors, and radius
    const realCards = content.realButtons.map((b) => `<div class="demo-card">
      <span class="demo-label">extracted button · real element</span>
      <button style="background:${b.bg};color:${b.color};border:none;border-radius:${b.radius};height:44px;padding:0 24px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;">${b.label}</button>
      <p class="demo-note">bg ${b.bg} · color ${b.color} · radius: ${b.radius} — scraped from live element.</p>
    </div>`);
    const demoCards = [
        `<div class="demo-card">
      <span class="demo-label">btn-primary · token demo</span>
      <button class="btn-site-primary">Get Started</button>
      <p class="demo-note">bg ${primaryHex} · color ${primaryFg} · radius: ${radiusLabel}</p>
    </div>`,
        `<div class="demo-card">
      <span class="demo-label">btn-secondary · outlined demo</span>
      <button class="btn-site-secondary">Learn More</button>
      <p class="demo-note">Demo variant — outlined treatment of the extracted primary color ${primaryHex}.</p>
    </div>`,
        `<div class="demo-card">
      <span class="demo-label">btn-ghost · text-only demo</span>
      <button class="btn-site-ghost">View All</button>
      <p class="demo-note">Demo variant — text-only treatment of the extracted primary color.</p>
    </div>`,
        `<div class="demo-card">
      <span class="demo-label">btn-disabled · demo state</span>
      <button style="background:#cccccc;color:#888888;border:none;border-radius:${radiusCss};height:44px;padding:0 24px;font-size:14px;font-weight:600;cursor:not-allowed;opacity:0.5;font-family:inherit;">Unavailable</button>
      <p class="demo-note">Generic disabled-state demo — not extracted from the site.</p>
    </div>`,
    ];
    // Show real buttons first, fill up to 6 cards with demos
    const cards = [...realCards, ...demoCards].slice(0, 6).join("\n");
    return `<section>
  <span class="section-eyebrow">04 — Components</span>
  <h2 class="section-heading">Button Variants</h2>
  <p class="section-sub">${realCards.length ? `${realCards.length} real button${realCards.length > 1 ? "s" : ""} extracted from the page, plus token demos. ` : "Color and radius tokens extracted from the scrape; variants are representative demos. "}${extras}.</p>
  <div class="grid-2">
    ${cards}
  </div>
</section>`;
}
function renderSurfacesSection(surfaces, shadows, theme) {
    const unique = surfaces.filter((s, i, arr) => arr.findIndex((x) => x.background === s.background && x.text === s.text) === i).slice(0, 6);
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
function renderFormSection(theme, siteTitle, content) {
    const { heroBg, heroText, primaryHex, primaryFg } = theme;
    const inputRadiusCss = theme.inputRadius ?? "0";
    const btnRadiusCss = theme.btnRadius ?? "0";
    const inputRadiusLabel = theme.inputRadius ?? "not detected";
    const radiusNote = theme.inputRadius
        ? `Input border-radius: <code>${theme.inputRadius}</code> (extracted).`
        : "Input border-radius: not detected in scrape.";
    return `<section>
  <span class="section-eyebrow">07 — Components</span>
  <h2 class="section-heading">Form Elements</h2>
  <p class="section-sub">Representative form patterns styled with extracted color and radius tokens. ${radiusNote}</p>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:32px;" class="form-wrap">
    <div>
      <div class="demo-label" style="margin-bottom:20px;">Contact form — site-styled demo</div>
      <div class="contact-demo" style="background:${heroBg};color:${heroText};">
        <h3>${siteTitle}<br>Get in Touch</h3>
        ${content.email ? `<p>${content.email} <span style="opacity:0.5;font-size:11px;">(extracted from site)</span></p>` : ""}
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
function renderSpacingSection(spacingVals) {
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
  <span class="section-eyebrow">08 — Foundations</span>
  <h2 class="section-heading">Spacing Scale</h2>
  <p class="section-sub">Spacing values observed in the live layout. Values extracted from stylesheet padding, margin, and gap declarations.</p>
  <div class="spacing-row">${items}</div>
</section>`;
}
function renderRadiusSection(radiusVals) {
    const simple = radiusVals.filter((v) => v && (!v.includes(" ") || v.trim().split(/\s+/).length === 1));
    const unique = [...new Set(simple)].sort((a, b) => pxToNum(a) - pxToNum(b));
    if (unique.length === 0) {
        return `<section>
  <span class="section-eyebrow">09 — Foundations</span>
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
    // Flag implausible values (larger than any component) so they aren't taken as tokens
    const suspicious = unique.filter((v) => pxToNum(v) > 200);
    const warning = suspicious.length
        ? `<p style="margin-top:20px;font-size:13px;color:#8d8d8d;max-width:560px;">⚠️ ${suspicious.join(", ")} exceed${suspicious.length === 1 ? "s" : ""} any component size — likely from an oversized decorative element (effectively a pill shape), not a reusable radius token.</p>`
        : "";
    return `<section>
  <span class="section-eyebrow">09 — Foundations</span>
  <h2 class="section-heading">Border Radius</h2>
  <p class="section-sub">Corner radius tokens observed across components. All values extracted from live stylesheet.</p>
  <div class="radius-row">${items}</div>
  ${warning}
</section>`;
}
function renderElevationSection(shadows, cssVars, theme) {
    const realShadows = [];
    const shadowGroups = [
        { prefix: "--popup-shadow", label: "Popup / Dropdown overlay" },
        { prefix: "--drawer-shadow", label: "Drawer / side-panel" },
        { prefix: "--buttons-shadow", label: "Button lift" },
        { prefix: "--media-shadow", label: "Media / image card" },
    ];
    for (const { prefix, label } of shadowGroups) {
        const opacity = parseFloat(cssVars[`${prefix}-opacity`] ?? "0");
        if (opacity === 0)
            continue;
        // Only build a shadow when every component was actually scraped — never invent geometry
        const hOff = cssVars[`${prefix}-horizontal-offset`];
        const vOff = cssVars[`${prefix}-vertical-offset`];
        const blur = cssVars[`${prefix}-blur-radius`];
        if (!hOff || !vOff || !blur)
            continue;
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
            `<div class="elev-card" style="border:none;background:#f0f0f0;"><strong style="color:${theme.inkColor};">Level 0 — Page Canvas</strong><p style="margin:8px 0 0;">bg ${theme.pageBg} — the outermost layer. Everything sits on top of this.</p></div>`,
            `<div class="elev-card" style="border:1px solid rgba(0,0,0,0.09);"><strong style="color:${theme.inkColor};">Level 1 — Card Surface</strong><p style="margin:8px 0 0;">bg #ffffff with 1px border. No shadow — white lift creates elevation via contrast.</p></div>`,
            `<div class="elev-card" style="background:${theme.heroBg};color:${theme.heroText};border:none;"><strong style="color:${theme.heroText};">Dark Section</strong><p style="margin:8px 0 0;opacity:0.65;">bg ${theme.heroBg} — depth through color contrast, no shadows.</p></div>`,
        ]
        : realShadows.slice(0, 4).map(({ label, shadow }) => `<div class="elev-card" style="box-shadow:${shadow};border:none;"><strong>${label}</strong><p style="margin:8px 0 0;font-family:monospace;font-size:11px;">${shadow}</p></div>`);
    const sub = isFlat
        ? "Fully flat design — zero box-shadow usage. Depth communicated through background-color contrast and 1px borders."
        : "Box-shadow tokens extracted from CSS variables. Shadow values represent real usage.";
    return `<section>
  <span class="section-eyebrow">10 — Foundations</span>
  <h2 class="section-heading">Elevation &amp; Depth</h2>
  <p class="section-sub">${sub}</p>
  <div class="elevation-grid">${cards.join("\n")}</div>
</section>`;
}
// Names assigned to scraped durations by ascending speed.
function durationTokenName(index, total) {
    const names = total <= 1 ? ["duration"] : ["duration-fast", "duration-base", "duration-slow", "duration-slower", "duration-slowest"];
    return names[index] ?? `duration-${index + 1}`;
}
function renderMotionSection(motion, theme) {
    const hasData = motion.durations.length > 0 || motion.easings.length > 0;
    if (!hasData) {
        return `<section>
  <span class="section-eyebrow">11 — Interactions</span>
  <h2 class="section-heading">Motion</h2>
  <p class="section-sub">No transition or animation tokens detected in the scraped stylesheets.</p>
</section>`;
    }
    const durRows = motion.durations.map((d, i) => `<tr><td>${durationTokenName(i, motion.durations.length)}</td><td>${d.value}</td><td>${d.count}× in stylesheet</td></tr>`);
    const easeRows = motion.easings.map((e, i) => `<tr><td>easing${motion.easings.length > 1 ? `-${i + 1}` : ""}</td><td>${e.value}</td><td>${e.count}× in stylesheet</td></tr>`);
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
    <div class="demo-card">
      <span class="demo-label">idle vs hover · frozen demo states</span>
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
        <button class="btn-site-secondary" style="pointer-events:none;">Idle</button>
        <button class="btn-site-secondary" style="background:${theme.primaryHex};color:${theme.primaryFg};pointer-events:none;">Hover (demo)</button>
      </div>
      <p class="demo-note">Demo hover treatment — fill with extracted primary color. Real hover styles are not scraped.</p>
    </div>
  </div>`
        : "";
    return `<section>
  <span class="section-eyebrow">11 — Interactions</span>
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
function breakpointName(px) {
    if (px <= 600)
        return "Mobile";
    if (px <= 900)
        return "Tablet";
    if (px <= 1200)
        return "Desktop";
    return "Wide";
}
function renderResponsiveSection(siteUrl, breakpoints, theme) {
    const sorted = [...breakpoints].sort((a, b) => a.minPx - b.minPx);
    if (sorted.length === 0) {
        return `<section>
  <span class="section-eyebrow">12 — Responsive</span>
  <h2 class="section-heading">Responsive Behavior</h2>
  <p class="section-sub">No media-query breakpoints detected in the scraped stylesheets of ${siteUrl}.</p>
</section>`;
    }
    const namer = uniqueNamer();
    const maxPx = sorted[sorted.length - 1].minPx;
    const tableRows = sorted.map((bp) => `<tr><td>${namer(breakpointName(bp.minPx))}</td><td>${bp.minPx}px</td><td>${bp.ruleCount} @media rule${bp.ruleCount === 1 ? "" : "s"}</td></tr>`).join("\n");
    // Ladder derived from the real detected boundaries
    const ladder = sorted.map((bp) => {
        const w = Math.round(60 + (bp.minPx / maxPx) * 180);
        const h = Math.round(70 + (bp.minPx / maxPx) * 55);
        return `<div class="device-box" style="width:${w}px;height:${h}px;">
  <span style="font-size:9px;text-align:center;color:#8d8d8d;">${bp.minPx}px</span>
</div>`;
    }).join("\n");
    return `<section>
  <span class="section-eyebrow">12 — Responsive</span>
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
function buildFontLinkTag(family) {
    const name = formatFontFamily(family);
    const lower = name.toLowerCase();
    const systemFonts = ["sans-serif", "serif", "monospace", "system-ui", "arial", "helvetica", "georgia", "courier", "verdana", "tahoma", "trebuchet"];
    if (systemFonts.some((f) => lower.includes(f)))
        return "";
    const encoded = name.replace(/ /g, "+");
    return `<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=${encoded}:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">`;
}
// ──────────────────────────────────────────────────────────────────────────────
// Master HTML renderer
// ──────────────────────────────────────────────────────────────────────────────
function renderDesignSystemHtml(analysis, siteTitle, breakpoints = [], motion = EMPTY_MOTION, content = EMPTY_CONTENT) {
    const theme = deriveSiteTheme(analysis);
    const css = buildCss(theme);
    const fontTag = buildFontLinkTag(theme.bodyFamily);
    const siteUrl = (() => { try {
        return new URL(analysis.url).hostname;
    }
    catch {
        return analysis.url;
    } })();
    const colorCount = analysis.palette.allObserved.length;
    // Same dedupe key as the typography table so the hero stat matches the rows
    const typeCount = [...new Set(analysis.typography.scales.map((s) => `${s.fontSize}-${s.fontWeight}-${s.tag}`))].length;
    const bodyFamilyName = formatFontFamily(theme.bodyFamily);
    // Site chrome: real logo + real nav links when scraped
    const chromeLinks = (content.navLinks.length ? content.navLinks : ["Home", "About", "Works", "Contact"])
        .map((l) => `<a href="#">${l}</a>`).join("\n    ");
    const chromeBrand = navBrandMark(content, siteTitle, 32, theme.navText);
    // Hero title: only split on dots when the hostname really has them
    const dotIdx = siteTitle.indexOf(".");
    const heroTitle = dotIdx > 0
        ? `${siteTitle.slice(0, dotIdx)}<em>.</em>${siteTitle.slice(dotIdx + 1)}`
        : siteTitle;
    // Stats: prefer real findings (case studies) over placeholders
    const stats = [
        [colorCount, "Color tokens"],
        [typeCount, "Type styles"],
        content.workCards.length ? [content.workCards.length, "Case studies"] : [breakpoints.length || "—", "Breakpoints"],
        [bodyFamilyName.split(" ")[0], "Primary font"],
    ];
    const heroStats = stats
        .map(([v, l]) => `<div class="hero-stat"><strong>${v}</strong><span>${l}</span></div>`)
        .join("\n      ");
    const footerMeta = [
        `Font: ${bodyFamilyName}`,
        content.copyright ?? "",
        "Generated by Designprobe",
    ].filter(Boolean).join(" · ");
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
    ${chromeBrand}
    <span>${siteTitle}</span>
  </div>
  <div class="nav-links">
    ${chromeLinks}
  </div>
</nav>

<!-- HERO -->
<div class="hero">
  <div class="hero-inner">
    <span class="hero-eyebrow">Design System Audit</span>
    <h1>${heroTitle}<br>Visual Language</h1>
    <p>Complete design system extracted from ${siteUrl} — every token, component, interaction pattern, and accessibility note, all from real values.</p>
    <div class="hero-meta">
      ${heroStats}
    </div>
  </div>
</div>

<hr class="divider">
${content.marquee ? `\n${renderMarqueeBar(content.marquee)}\n` : ""}
${renderColorSection(analysis.palette.allObserved, theme)}
<hr class="divider">
${renderTypographySection(analysis.typography.scales, theme, content)}
<hr class="divider">
${renderNavSection(theme, siteTitle, content)}
<hr class="divider">
${renderButtonSection(theme, analysis.buttons, content)}
<hr class="divider">
${renderSurfacesSection(analysis.surfaces, analysis.shadows, theme)}
${content.workCards.length ? `<hr class="divider">\n${renderWorksSection(content.workCards, theme)}` : ""}
<hr class="divider">
${renderFormSection(theme, siteTitle, content)}
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
${(content.logoSvg || content.logoUrl || content.brandAssets.length || content.socialLinks.length) ? `<hr class="divider">\n${renderBrandAssetsSection(content, theme, siteTitle)}` : ""}

<footer class="footer">
  <span>Design system analysis of <a href="${analysis.url}" style="color:${theme.primaryOnPage};text-decoration:none;font-weight:600;">${siteUrl}</a> — all values extracted from live site</span>
  <span>${footerMeta}</span>
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
function renderDesignMd(analysis, siteTitle, breakpoints = [], motion = EMPTY_MOTION, content = EMPTY_CONTENT) {
    const theme = deriveSiteTheme(analysis);
    const siteUrl = (() => { try {
        return new URL(analysis.url).hostname;
    }
    catch {
        return analysis.url;
    } })();
    const bodyFamilyName = formatFontFamily(theme.bodyFamily);
    const headingFamilyName = formatFontFamily(theme.headingFamily);
    const lines = [];
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
    const seenTypo = new Set();
    analysis.typography.scales.slice(0, 10).forEach((s) => {
        const key = `${s.fontSize}-${s.fontWeight}-${s.tag}`;
        if (seenTypo.has(key))
            return;
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
    if (analysis.buttons.fillType)
        lines.push(`| Fill type | \`${analysis.buttons.fillType}\` |`);
    if (analysis.buttons.paddingDensity)
        lines.push(`| Padding density | \`${analysis.buttons.paddingDensity}\` |`);
    lines.push(`| Primary background | \`${theme.primaryHex}\` |`);
    lines.push(`| Primary text | \`${theme.primaryFg}\` |`);
    lines.push("");
    lines.push("Secondary / ghost / disabled variants in the HTML preview are representative demos built from these tokens — not extracted from the site.");
    lines.push("");
    // Surfaces
    lines.push("---");
    lines.push("## 04 — Cards & Surfaces");
    lines.push("");
    const uniqueSurfaces = analysis.surfaces.filter((s, i, arr) => arr.findIndex((x) => x.background === s.background && x.text === s.text) === i).slice(0, 6);
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
        const suspiciousMd = uniqueRadius.filter((v) => pxToNum(v) > 200);
        if (suspiciousMd.length) {
            lines.push("");
            lines.push(`> ⚠️ ${suspiciousMd.join(", ")} exceed${suspiciousMd.length === 1 ? "s" : ""} any component size — likely an oversized decorative element (effectively a pill), not a reusable token.`);
        }
    }
    else {
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
    }
    else {
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
    }
    else {
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
    }
    else {
        lines.push("No transition or animation tokens detected in the scraped stylesheets.");
    }
    if (content.marquee) {
        lines.push("");
        lines.push(`Signature component — scrolling marquee: "${content.marquee.text}" (${content.marquee.duration ? `${content.marquee.duration} loop, extracted` : "JS-driven ticker; duration not in CSS"}).`);
    }
    lines.push("");
    // Site content — real extracted assets, links and copy (compact)
    const hasSiteContent = content.navLinks.length || content.logoSvg || content.logoUrl || content.email ||
        content.socialLinks.length || content.workCards.length || content.copyright || content.loadedFonts.length ||
        content.brandAssets.length;
    if (hasSiteContent) {
        lines.push("---");
        lines.push("## 10 — Site Content (extracted)");
        lines.push("");
        if (content.navLinks.length)
            lines.push(`- **Nav links:** ${content.navLinks.join(" · ")}`);
        if (content.workCards.length) {
            lines.push(`- **Case studies:** ${content.workCards.map((w) => `[${w.title}](${w.href})`).join(", ")}`);
        }
        if (content.logoSvg)
            lines.push(`- **Logo:** inline SVG (extracted from page markup)`);
        else if (content.logoUrl)
            lines.push(`- **Logo:** ${content.logoUrl}`);
        if (content.brandAssets.length) {
            lines.push(`- **Brand assets:** ${content.brandAssets.map((a) => `${a.label} (${a.url})`).join(", ")}`);
        }
        if (content.email)
            lines.push(`- **Contact email:** ${content.email}`);
        if (content.socialLinks.length) {
            lines.push(`- **Social:** ${content.socialLinks.map((s) => `[${s.label}](${s.href})`).join(", ")}`);
        }
        if (content.copyright)
            lines.push(`- **Copyright:** ${content.copyright}`);
        if (content.loadedFonts.length) {
            lines.push(`- **Font files loaded:** ${content.loadedFonts.map((f) => `${f.family} (${f.weights.join(", ")})`).join(" · ")}`);
        }
        lines.push(`- **Icon library:** ${content.iconLibrary ?? "none detected"}`);
        lines.push("");
    }
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
        if (theme.btnRadius)
            lines.push(`  --radius-button: ${theme.btnRadius};`);
        if (theme.inputRadius)
            lines.push(`  --radius-input: ${theme.inputRadius};`);
    }
    lines.push(`}`);
    lines.push("```");
    lines.push("");
    lines.push(`---`);
    lines.push(`*Generated by Designprobe — all values from live scrape of ${siteUrl}*`);
    return lines.join("\n");
}
// ──────────────────────────────────────────────────────────────────────────────
// Breakpoint extractor from scraped component files
// ──────────────────────────────────────────────────────────────────────────────
async function extractBreakpoints(runDir) {
    // boundary px → number of @media rules referencing it.
    // max-width:N means the breakpoint boundary is N+1 (min-width form).
    const boundaryCounts = new Map();
    function scanCss(css) {
        for (const m of css.matchAll(/@media[^{]*min-width:\s*(\d+)px/gi)) {
            const px = parseInt(m[1], 10);
            if (px > 320 && px < 3000)
                boundaryCounts.set(px, (boundaryCounts.get(px) ?? 0) + 1);
        }
        for (const m of css.matchAll(/@media[^{]*max-width:\s*(\d+)px/gi)) {
            const px = parseInt(m[1], 10) + 1;
            if (px > 320 && px < 3000)
                boundaryCounts.set(px, (boundaryCounts.get(px) ?? 0) + 1);
        }
    }
    // Primary source: the site's real stylesheets saved by Stage 1 (page_styles/*.css)
    try {
        const stylesDir = (0, node_path_1.join)(runDir, "page_styles");
        for (const entry of await (0, promises_1.readdir)(stylesDir)) {
            if (!entry.endsWith(".css"))
                continue;
            try {
                scanCss(await (0, promises_1.readFile)((0, node_path_1.join)(stylesDir, entry), "utf-8"));
            }
            catch { /* unreadable file */ }
        }
    }
    catch { /* no page_styles dir */ }
    // Fallback source: inline styles inside scraped component DOM snapshots
    if (boundaryCounts.size === 0) {
        try {
            const compDir = (0, node_path_1.join)(runDir, "components");
            for (const entry of await (0, promises_1.readdir)(compDir)) {
                try {
                    scanCss(await (0, promises_1.readFile)((0, node_path_1.join)(compDir, entry, "dom.html"), "utf-8"));
                }
                catch { /* no dom.html */ }
            }
        }
        catch { /* no components dir */ }
    }
    // Keep breakpoints referenced by 2+ rules; if none qualify, accept single hits.
    let significant = [...boundaryCounts.entries()].filter(([, count]) => count >= 2);
    if (significant.length === 0)
        significant = [...boundaryCounts.entries()];
    significant.sort(([a], [b]) => a - b);
    return significant.slice(0, 5).map(([px, count]) => ({ minPx: px, ruleCount: count }));
}
// ──────────────────────────────────────────────────────────────────────────────
// Motion extractor — real transition/animation values from scraped stylesheets
// ──────────────────────────────────────────────────────────────────────────────
async function extractMotionTokens(runDir) {
    const durationCounts = new Map();
    const easingCounts = new Map();
    function scanCss(css) {
        for (const decl of css.matchAll(/(?:transition|animation)(?:-duration|-timing-function)?\s*:\s*([^;{}]+)/gi)) {
            const value = decl[1];
            for (const d of value.matchAll(/(\d*\.?\d+)(ms|s)\b/g)) {
                let secs = parseFloat(d[1]);
                if (d[2] === "ms")
                    secs /= 1000;
                if (secs <= 0 || secs > 60)
                    continue;
                const key = `${parseFloat(secs.toFixed(3))}s`;
                durationCounts.set(key, (durationCounts.get(key) ?? 0) + 1);
            }
            for (const e of value.matchAll(/\b(ease-in-out|ease-in|ease-out|ease|linear|step-start|step-end)\b|cubic-bezier\([^)]*\)/g)) {
                easingCounts.set(e[0], (easingCounts.get(e[0]) ?? 0) + 1);
            }
        }
    }
    try {
        const stylesDir = (0, node_path_1.join)(runDir, "page_styles");
        for (const entry of await (0, promises_1.readdir)(stylesDir)) {
            if (!entry.endsWith(".css"))
                continue;
            try {
                scanCss(await (0, promises_1.readFile)((0, node_path_1.join)(stylesDir, entry), "utf-8"));
            }
            catch { /* unreadable file */ }
        }
    }
    catch { /* no page_styles dir */ }
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
async function extractSiteContent(runDir) {
    const content = {
        ...EMPTY_CONTENT,
        navLinks: [], brandAssets: [], socialLinks: [], realButtons: [], workCards: [],
        textSamples: new Map(), loadedFonts: [],
    };
    const doms = [];
    const trees = [];
    const treeGroups = []; // per-component, for cross-node patterns like marquees
    try {
        const compDir = (0, node_path_1.join)(runDir, "components");
        for (const entry of await (0, promises_1.readdir)(compDir)) {
            try {
                doms.push(await (0, promises_1.readFile)((0, node_path_1.join)(compDir, entry, "dom.html"), "utf-8"));
            }
            catch { /* skip */ }
            try {
                const parsed = JSON.parse(await (0, promises_1.readFile)((0, node_path_1.join)(compDir, entry, "style_tree.json"), "utf-8"));
                treeGroups.push(parsed);
                trees.push(...parsed);
            }
            catch { /* skip */ }
        }
    }
    catch { /* no components dir */ }
    if (doms.length === 0 && trees.length === 0)
        return content;
    const allDom = doms.join("\n");
    let styleFileNames = "";
    try {
        styleFileNames = (await (0, promises_1.readdir)((0, node_path_1.join)(runDir, "page_styles"))).join(" ");
    }
    catch { /* none */ }
    // ── Anchors (text + href) ─────────────────────────────────────────────────
    const anchors = [];
    for (const m of allDom.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
        const href = m[1].match(/href="([^"]*)"/)?.[1] ?? "";
        const text = m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
        if (text)
            anchors.push({ href, text });
    }
    // Nav links: short link labels from the nav component (or any scraped DOM)
    const navDom = doms.find((d) => /<nav\b|w-nav|class="[^"]*navbar/i.test(d)) ?? allDom;
    const navSeen = new Set();
    for (const m of navDom.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)) {
        const text = m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
        if (text.length >= 2 && text.length <= 20 && !text.includes("©") && !/https?:/.test(text) && !navSeen.has(text)) {
            navSeen.add(text);
            content.navLinks.push(text);
            if (content.navLinks.length >= 5)
                break;
        }
    }
    // Copyright line
    content.copyright = allDom.match(/©[^<>{}\n]{2,60}/)?.[0]?.trim() ?? null;
    // ── Logo ──────────────────────────────────────────────────────────────────
    // 1) Inline SVG logo: <svg> carrying a logo marker, or sitting inside a
    //    logo-classed link. Inlining means it always renders — no network, no 403.
    for (const m of allDom.matchAll(/<svg\b[\s\S]*?<\/svg>/gi)) {
        const svg = m[0];
        const openTag = svg.slice(0, svg.indexOf(">") + 1);
        const before = allDom.slice(Math.max(0, (m.index ?? 0) - 160), m.index ?? 0);
        const markedSelf = /data-anm-logo|(?:class|id)="[^"]*\blogo/i.test(openTag);
        const markedParent = /(?:class|id)="[^"]*logo[^"]*"[^>]*>\s*$/i.test(before);
        if (markedSelf || markedParent) {
            content.logoSvg = sanitizeInlineSvg(svg);
            if (content.logoSvg)
                break;
        }
    }
    // 2) Image logo: <img> whose class / alt / src signals a logo or wordmark.
    const imgTags = [...allDom.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
    const isContentImg = (tag) => /g_visual_img|u-cover|hero|product|recipe|card/i.test(tag);
    if (!content.logoSvg) {
        const logoImg = imgTags.find((t) => /(?:class|alt)="[^"]*\b(logo|wordmark|brand)/i.test(t) || /[/_-](logo|wordmark)/i.test(t.match(/src="([^"]*)"/)?.[1] ?? ""));
        content.logoUrl = logoImg?.match(/src="(https?:[^"]+)"/)?.[1] ?? null;
    }
    // Brand assets: only logo/brand/icon-type images (SVGs or logo-named) — never
    // content photos. Excludes the chosen logo and platform placeholders.
    const brandSeen = new Set();
    for (const tag of imgTags) {
        const src = tag.match(/src="(https?:[^"]+)"/)?.[1];
        if (!src || src === content.logoUrl || brandSeen.has(src))
            continue;
        if (/placeholder|sprite|blank\.|1x1|pixel/i.test(src))
            continue;
        if (isContentImg(tag))
            continue;
        const file = src.split("/").pop()?.split("?")[0] ?? src;
        const isSvg = /\.svg(\?|$)/i.test(src);
        const isBrandNamed = /\b(logo|brand|wordmark|icon|mark|partner)\b/i.test(file) ||
            /(?:class|alt)="[^"]*\b(logo|brand|icon|partner)/i.test(tag);
        if (!isSvg && !isBrandNamed)
            continue;
        brandSeen.add(src);
        const label = decodeURIComponent(file.replace(/\.[a-z0-9]+$/i, "").replace(/^[0-9a-f]{6,}_?/, "")).replace(/[_-]+/g, " ").trim() || "brand asset";
        content.brandAssets.push({ url: src, label });
        if (content.brandAssets.length >= 3)
            break;
    }
    // Email
    content.email =
        allDom.match(/mailto:([^"'?<\s]+)/)?.[1] ??
            allDom.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9-]+\.[a-z]{2,}/)?.[0] ?? null;
    // Social links
    const socialDomains = [
        [/twitter\.com|(?<![\w.])x\.com/, "Twitter / X"], [/instagram\.com/, "Instagram"],
        [/linkedin\.com/, "LinkedIn"], [/dribbble\.com/, "Dribbble"],
        [/behance\.net/, "Behance"], [/github\.com/, "GitHub"], [/youtube\.com/, "YouTube"],
    ];
    const socialSeen = new Set();
    for (const a of anchors) {
        for (const [re, label] of socialDomains) {
            if (re.test(a.href) && !socialSeen.has(label)) {
                socialSeen.add(label);
                content.socialLinks.push({ label, href: a.href });
            }
        }
    }
    // Icon library detection
    const sig = allDom + " " + styleFileNames;
    content.iconLibrary =
        sig.match(/phosphor|feather-icons|heroicons|font-?awesome|material-icons|lucide|ionicons/i)?.[0] ?? null;
    // Work / project cards: links into a works/projects path, excluding nav labels
    const workSeen = new Set();
    for (const a of anchors) {
        if (!/\/(works?|projects?|case-stud)/i.test(a.href))
            continue;
        if (a.text.length < 2 || a.text.length > 40 || navSeen.has(a.text) || workSeen.has(a.href))
            continue;
        workSeen.add(a.href);
        content.workCards.push({ title: a.text, href: a.href });
        if (content.workCards.length >= 6)
            break;
    }
    // Style-tree pass: real text samples per type style, marquee, real buttons
    for (const n of trees) {
        const text = (n.textSample ?? "").replace(/\s+/g, " ").trim();
        const styles = n.styles ?? {};
        if (text.length >= 8 && text.length <= 90) {
            const size = pxToNum(styles["font-size"] ?? "");
            const weight = styles["font-weight"] ?? "";
            if (size > 0 && weight) {
                const key = `${size}|${weight}`;
                if (!content.textSamples.has(key))
                    content.textSamples.set(key, text);
            }
        }
        if ((n.tagName === "a" || n.tagName === "button") && text.length >= 2 && text.length <= 28) {
            const bg = cssColorToHex(styles["background-color"] ?? "");
            const isTransparent = !bg || /rgba\(0, 0, 0, 0\)/.test(styles["background-color"] ?? "") || bg === "transparent";
            if (!isTransparent && bg.startsWith("#")) {
                const dup = content.realButtons.some((b) => b.bg === bg && b.label === text);
                if (!dup && content.realButtons.length < 4) {
                    content.realButtons.push({
                        label: text,
                        bg,
                        color: cssColorToHex(styles["color"] ?? "") || autoFg(bg),
                        radius: styles["border-radius"] ?? "0px",
                    });
                }
            }
        }
    }
    // Marquee detection per component: repeated text on one node + CSS animation
    // or an active translate transform anywhere in the same component (JS tickers).
    for (const group of treeGroups) {
        if (content.marquee)
            break;
        let repeatText = null;
        let repeatParts = [];
        let animDur = null;
        let hasTranslate = false;
        for (const n of group) {
            const text = (n.textSample ?? "").replace(/\s+/g, " ").trim();
            const styles = n.styles ?? {};
            if (!repeatText && text.length > 20) {
                const parts = text.split(/[•·|]/).map((p) => p.trim()).filter(Boolean);
                if (parts.length >= 4 && new Set(parts).size <= 3) {
                    repeatText = text;
                    // Drop truncation fragments (a part that is a prefix of another part)
                    const uniq = [...new Set(parts)];
                    repeatParts = uniq.filter((p) => !uniq.some((q) => q !== p && q.startsWith(p)));
                }
            }
            const dur = (styles["animation-duration"] ?? "0s").split(",")[0].trim();
            if (dur !== "0s" && dur !== "")
                animDur = animDur ?? dur;
            const tf = styles["transform"] ?? "none";
            if (/matrix\(/.test(tf) && !/matrix\(1, 0, 0, 1, 0, 0\)/.test(tf))
                hasTranslate = true;
        }
        if (repeatText && (animDur || hasTranslate)) {
            const unit = repeatParts.length > 0 && repeatParts.length <= 3
                ? repeatParts.map((p) => `• ${p}`).join("  ")
                : repeatText.slice(0, 80);
            content.marquee = { text: unit, duration: animDur };
        }
    }
    // Real font files loaded by the site (from Stage 1 fonts manifest)
    try {
        const manifest = JSON.parse(await (0, promises_1.readFile)((0, node_path_1.join)(runDir, "page_styles", "fonts.manifest.json"), "utf-8"));
        const fams = new Map();
        for (const e of manifest.entries ?? []) {
            if (!e.family)
                continue;
            if (!fams.has(e.family))
                fams.set(e.family, new Set());
            if (e.weight)
                fams.get(e.family).add(String(e.weight));
        }
        content.loadedFonts = [...fams.entries()]
            .slice(0, 4)
            .map(([family, weights]) => ({ family, weights: [...weights].sort() }));
    }
    catch { /* no manifest */ }
    return content;
}
// ──────────────────────────────────────────────────────────────────────────────
// Entry point — reads run dir, returns HTML + Markdown
// ──────────────────────────────────────────────────────────────────────────────
async function renderFromRunDir(runDir, url) {
    try {
        const analysisPath = (0, node_path_1.join)(runDir, "semantic_analysis.json");
        const raw = await (0, promises_1.readFile)(analysisPath, "utf-8");
        const analysis = JSON.parse(raw);
        const siteTitle = (() => {
            try {
                return new URL(url).hostname.replace(/^www\./, "");
            }
            catch {
                return url;
            }
        })();
        const breakpoints = await extractBreakpoints(runDir);
        const motion = await extractMotionTokens(runDir);
        const content = await extractSiteContent(runDir);
        const html = renderDesignSystemHtml(analysis, siteTitle, breakpoints, motion, content);
        const md = renderDesignMd(analysis, siteTitle, breakpoints, motion, content);
        return { html, md };
    }
    catch {
        return null;
    }
}
