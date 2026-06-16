"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderNintendoHtml = renderNintendoHtml;
exports.renderFromRunDir = renderFromRunDir;
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function rgbCssToHex(val) {
    if (!val)
        return "";
    const trimmed = val.trim();
    if (trimmed.startsWith("#"))
        return trimmed;
    // Handle "r,g,b" format stored in resolvedCssVariables
    const parts = trimmed.split(",").map((s) => parseInt(s.trim(), 10));
    if (parts.length === 3 && parts.every((n) => !isNaN(n))) {
        return "#" + parts.map((n) => n.toString(16).padStart(2, "0")).join("");
    }
    return trimmed;
}
function pxToNum(val) {
    return parseInt(val.replace("px", ""), 10) || 0;
}
function isSimpleRadius(val) {
    return !val.includes(" ") || val.trim().split(/\s+/).length === 1;
}
function colorLuminance(hex) {
    const c = hex.replace("#", "");
    if (c.length !== 6)
        return 0.5;
    const r = parseInt(c.slice(0, 2), 16) / 255;
    const g = parseInt(c.slice(2, 4), 16) / 255;
    const b = parseInt(c.slice(4, 6), 16) / 255;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrastColor(hex) {
    return colorLuminance(hex) > 0.4 ? "#21242e" : "#ffffff";
}
function assignColorName(c, index, primaryHex) {
    const h = c.hex.toLowerCase();
    const isBackground = c.roles.includes("background");
    const isText = c.roles.includes("text");
    if (h === primaryHex.toLowerCase())
        return "primary";
    if (h === "#ffffff")
        return "surface";
    if (h === "#000000")
        return "ink";
    if (c.areaWeight > 20 && isBackground && !isText)
        return "canvas";
    if (c.areaWeight > 5 && isBackground)
        return "canvas-soft";
    if (isText && !isBackground && c.frequency > 50)
        return "foreground";
    if (isText && !isBackground && h.includes("ee") && h.includes("00"))
        return "link";
    if (isBackground && c.areaWeight > 1)
        return `surface-${index}`;
    if (isText)
        return `text-${index}`;
    return `accent-${index}`;
}
function colorRole(c) {
    const roles = c.roles.map((r) => r.replace("_", " "));
    if (c.areaWeight > 30)
        return `Dominant — ${roles.join(", ")}`;
    if (c.areaWeight > 5)
        return `Major — ${roles.join(", ")}`;
    if (c.areaWeight > 1)
        return `Supporting — ${roles.join(", ")}`;
    return `Accent — ${roles.join(", ")}`;
}
function formatFontFamily(family) {
    return family.split(",")[0].replace(/['"]/g, "").trim();
}
function typoRoleName(scale, index) {
    const size = pxToNum(scale.fontSize);
    const weight = parseInt(scale.fontWeight, 10);
    if (size >= 28 && weight >= 500)
        return "display";
    if (size >= 20 && weight >= 500)
        return "heading";
    if (size >= 16 && weight >= 600)
        return "ui-label";
    if (size >= 16 && scale.tag === "a")
        return "link";
    if (size >= 16)
        return "body";
    if (size >= 13 && weight >= 500)
        return "caption";
    return "micro";
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
        return "xxl";
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
// ---------------------------------------------------------------------------
// Section renderers
// ---------------------------------------------------------------------------
function renderColorSection(colors, primaryHex) {
    const swatches = colors
        .map((c, i) => {
        const name = assignColorName(c, i, primaryHex);
        const role = colorRole(c);
        return `<div class="swatch">
  <div class="swatch-fill" style="background:${c.hex};"></div>
  <div class="swatch-meta">
    <p class="swatch-name">${name}</p>
    <p class="swatch-hex">${c.hex}</p>
    <p class="swatch-role">${role}</p>
  </div>
</div>`;
    })
        .join("\n");
    return `<section>
  <span class="section-eyebrow">01 — Foundations</span>
  <h2 class="section-heading">Color Palette</h2>
  <div class="palette-grid">${swatches}</div>
</section>`;
}
function renderTypographySection(scales, bodyFamily, headingFamily) {
    const seen = new Set();
    const unique = scales.filter((s) => {
        const key = `${s.fontSize}-${s.fontWeight}-${s.tag}`;
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
    const rows = unique
        .slice(0, 8)
        .map((s, i) => {
        const role = typoRoleName(s, i);
        const family = formatFontFamily(s.tag === "div" || s.tag === "h1" ? headingFamily : bodyFamily);
        const lh = s.lineHeight !== "0px" ? (pxToNum(s.lineHeight) / pxToNum(s.fontSize)).toFixed(2) : "1.0";
        const spec = `${family} · ${s.fontSize} / ${s.fontWeight}`;
        const sampleText = role === "display" || role === "heading" ? "The quick brown fox" : "The quick brown fox jumps over the lazy dog";
        return `<div class="type-row">
  <div class="type-meta">
    ${role}<br>
    ${spec}<br>
    lh ${lh} · ls 0<br>
    <span style="color:#888;">${s.tag.toUpperCase()} element · ${s.usageCount} uses</span>
  </div>
  <div style="font-size:${s.fontSize};font-weight:${s.fontWeight};line-height:${s.lineHeight || "1.4"};color:${s.color};">${sampleText}</div>
</div>`;
    })
        .join("\n");
    return `<section>
  <span class="section-eyebrow">02 — Foundations</span>
  <h2 class="section-heading">Typography</h2>
  <p style="color:#60619c;margin:-16px 0 28px;max-width:720px;">
    Body: ${formatFontFamily(bodyFamily)} · Heading: ${formatFontFamily(headingFamily)}
  </p>
  ${rows}
</section>`;
}
function renderButtonSection(primaryHex, primaryFg, btnRadius, secondaryBg, secondaryFg) {
    const secBg = secondaryBg || "#ffffff";
    const secFg = secondaryFg || primaryHex;
    return `<section>
  <span class="section-eyebrow">03 — Components</span>
  <h2 class="section-heading">Button Variants</h2>
  <div class="button-grid">
    <div class="demo-card">
      <span class="label">button-primary · filled CTA</span>
      <button style="background:${primaryHex};color:${primaryFg};border:2px solid ${primaryHex};border-radius:${btnRadius};height:44px;padding:0 24px;font-size:15px;font-weight:600;cursor:pointer;">
        Get Started
      </button>
      <p style="font-size:12px;color:#60619c;margin:12px 0 0;">Primary brand fill — the main call-to-action.</p>
    </div>
    <div class="demo-card">
      <span class="label">button-secondary · outlined</span>
      <button style="background:${secBg};color:${secFg};border:2px solid ${primaryHex};border-radius:${btnRadius};height:44px;padding:0 24px;font-size:15px;font-weight:600;cursor:pointer;">
        Learn More
      </button>
      <p style="font-size:12px;color:#60619c;margin:12px 0 0;">Outlined secondary — lower emphasis action.</p>
    </div>
    <div class="demo-card">
      <span class="label">button-ghost · text only</span>
      <button style="background:transparent;color:${primaryHex};border:none;border-radius:${btnRadius};height:44px;padding:0 24px;font-size:15px;font-weight:500;cursor:pointer;text-decoration:underline;">
        View All
      </button>
      <p style="font-size:12px;color:#60619c;margin:12px 0 0;">Ghost / text button — minimal hierarchy.</p>
    </div>
    <div class="demo-card">
      <span class="label">button-disabled · inactive state</span>
      <button style="background:#cccccc;color:#888888;border:2px solid #cccccc;border-radius:${btnRadius};height:44px;padding:0 24px;font-size:15px;font-weight:600;cursor:not-allowed;opacity:0.6;">
        Unavailable
      </button>
      <p style="font-size:12px;color:#60619c;margin:12px 0 0;">Disabled state — reduced opacity, no interaction.</p>
    </div>
  </div>
</section>`;
}
function renderSurfacesSection(surfaces) {
    const uniqueSurfaces = surfaces.filter((s, i, arr) => arr.findIndex((x) => x.background === s.background && x.text === s.text) === i);
    const cards = uniqueSurfaces
        .slice(0, 6)
        .map((s) => {
        const roleName = s.role.replace(/_/g, " ");
        return `<div class="feature-card" style="background:${s.background};color:${s.text};">
  <h4>${roleName}</h4>
  <p style="color:${s.text};opacity:0.7;">Background: ${s.background} · Text: ${s.text}</p>
</div>`;
    })
        .join("\n");
    return `<section>
  <span class="section-eyebrow">04 — Components</span>
  <h2 class="section-heading">Cards &amp; Surfaces</h2>
  <div class="card-grid">${cards}</div>
</section>`;
}
function renderFormSection(primaryHex, inputRadius, primaryFg) {
    return `<section>
  <span class="section-eyebrow">05 — Components</span>
  <h2 class="section-heading">Form Elements</h2>
  <div class="form-grid">
    <div class="demo-card">
      <span class="label">text-input · default</span>
      <input class="ex-input-demo" placeholder="Enter text…" style="border-radius:${inputRadius};">
    </div>
    <div class="demo-card">
      <span class="label">search-field + submit</span>
      <div style="display:flex;gap:6px;">
        <input class="ex-input-demo" placeholder="Search…" style="border-radius:${inputRadius};">
        <button style="background:${primaryHex};color:${primaryFg};border:none;border-radius:${inputRadius};padding:0 16px;font-size:13px;cursor:pointer;">Go</button>
      </div>
    </div>
    <div class="demo-card">
      <span class="label">select-dropdown</span>
      <select style="width:100%;background:#fff;border:1px solid #ccc;color:#333;padding:10px 12px;font-size:14px;border-radius:${inputRadius};height:44px;">
        <option>Choose an option</option>
        <option>Option A</option>
        <option>Option B</option>
      </select>
    </div>
    <div class="demo-card">
      <span class="label">textarea · multi-line</span>
      <textarea style="width:100%;background:#fff;border:1px solid #ccc;color:#333;padding:10px 12px;font-size:14px;border-radius:${inputRadius};resize:vertical;min-height:72px;font-family:inherit;" placeholder="Your message…"></textarea>
    </div>
    <div class="demo-card">
      <span class="label">checkbox + label</span>
      <div style="display:flex;align-items:center;gap:10px;font-size:14px;">
        <input type="checkbox" style="width:18px;height:18px;accent-color:${primaryHex};">
        <span>I agree to the terms</span>
      </div>
    </div>
    <div class="demo-card">
      <span class="label">radio group</span>
      <div style="display:flex;flex-direction:column;gap:8px;font-size:14px;">
        <label style="display:flex;align-items:center;gap:8px;"><input type="radio" name="demo" style="accent-color:${primaryHex};"> Option One</label>
        <label style="display:flex;align-items:center;gap:8px;"><input type="radio" name="demo" style="accent-color:${primaryHex};"> Option Two</label>
      </div>
    </div>
  </div>
</section>`;
}
function renderSpacingSection(spacingVals) {
    const positive = spacingVals.filter((v) => !v.startsWith("-"));
    const unique = [...new Set(positive)].sort((a, b) => pxToNum(a) - pxToNum(b));
    const tokens = unique.map((v) => {
        const px = pxToNum(v);
        const name = spacingName(px);
        const width = Math.max(8, Math.min(px, 120));
        return `<div>
  <div class="spacing-box" style="width:${width}px;"></div>
  <div class="spacing-label">${name}<br>${v}</div>
</div>`;
    });
    return `<section>
  <span class="section-eyebrow">06 — Foundations</span>
  <h2 class="section-heading">Spacing Scale</h2>
  <p style="color:#60619c;margin:-16px 0 28px;">Spacing values observed in the layout.</p>
  <div class="spacing-row">${tokens.join("\n")}</div>
</section>`;
}
function renderRadiusSection(radiusVals) {
    const simple = radiusVals.filter(isSimpleRadius);
    const unique = [...new Set(simple)].sort((a, b) => pxToNum(a) - pxToNum(b));
    // Always include 0px
    if (!unique.includes("0px"))
        unique.unshift("0px");
    const tokens = unique.slice(0, 8).map((v) => {
        const name = radiusName(v);
        return `<div>
  <div class="radius-box" style="border-radius:${v};">${v}</div>
  <div class="radius-label">${name}</div>
</div>`;
    });
    return `<section>
  <span class="section-eyebrow">07 — Foundations</span>
  <h2 class="section-heading">Border Radius</h2>
  <p style="color:#60619c;margin:-16px 0 28px;">Corner radius tokens observed across components.</p>
  <div class="radius-row">${tokens.join("\n")}</div>
</section>`;
}
function renderElevationSection(shadows, cssVars) {
    // Build real box-shadow values from scraped CSS variables.
    // Only use a shadow if its opacity is non-zero.
    const realShadows = [];
    // Levainbakery-style: check each component's shadow vars
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
        const hOff = cssVars[`${prefix}-horizontal-offset`] ?? "0px";
        const vOff = cssVars[`${prefix}-vertical-offset`] ?? "4px";
        const blur = cssVars[`${prefix}-blur-radius`] ?? "5px";
        realShadows.push({ label, shadow: `${hOff} ${vOff} ${blur} rgba(0,0,0,${opacity})` });
    }
    // Also include any raw shadow strings scraped from elements
    for (const s of shadows) {
        if (s && s !== "none")
            realShadows.push({ label: "Observed element shadow", shadow: s });
    }
    const isFlatDesign = realShadows.length === 0;
    const cards = isFlatDesign
        ? [
            `<div class="elev-card elev-1">Flat / borderless — this site uses no box-shadow elevation. Depth is created through background-color contrast and solid borders.</div>`,
            `<div class="elev-card" style="border:1px solid #d0d0d0;">Border elevation — 1px solid border distinguishes surfaces. Used for cards, inputs, and containers.</div>`,
            `<div class="elev-card" style="background:#f4f4f4;border:none;">Background elevation — lighter/darker fill communicates nesting, no shadow needed.</div>`,
        ]
        : realShadows.slice(0, 4).map(({ label, shadow }) => {
            return `<div class="elev-card" style="box-shadow:${shadow};border:none;">${label} — <code style="font-size:11px;">${shadow}</code></div>`;
        });
    return `<section>
  <span class="section-eyebrow">08 — Foundations</span>
  <h2 class="section-heading">Elevation &amp; Depth</h2>
  <p style="color:#60619c;margin:-16px 0 28px;">${isFlatDesign ? "Flat design — elevation is expressed through color contrast and borders, not shadows." : "Box-shadow tokens extracted from CSS variables."}</p>
  <div class="elevation-grid">${cards.join("\n")}</div>
</section>`;
}
function renderResponsiveSection(siteUrl, breakpoints) {
    // Sort breakpoints ascending
    const sorted = [...breakpoints].sort((a, b) => a.minPx - b.minPx);
    // Build ladder boxes — clamp display width between 40–280px
    const ladder = sorted.map((bp) => {
        const w = Math.round(40 + (bp.minPx / 1440) * 240);
        return `<div class="device-box" style="width:${w}px;height:96px;">${bp.minPx}</div>`;
    });
    const rows = sorted
        .map((bp, i) => {
        const prev = sorted[i - 1];
        const range = prev ? `${prev.minPx}–${bp.minPx}px` : `&lt; ${bp.minPx}px`;
        return `<tr><td>${bp.name}</td><td>${bp.minPx}px +</td><td>${bp.changes}</td></tr>`;
    })
        .join("\n");
    return `<section>
  <span class="section-eyebrow">09 — Responsive</span>
  <h2 class="section-heading">Responsive Behavior</h2>
  <table class="responsive-table">
    <thead><tr><th>Breakpoint</th><th>Min-width</th><th>Key changes</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="device-ladder" style="margin-top:24px;">${ladder.join("\n")}</div>
  <p style="color:#60619c;margin-top:24px;font-size:14px;">
    Breakpoints extracted from <strong style="color:#21242e;">${siteUrl}</strong> stylesheet media queries.
    Touch targets follow WCAG 2.1 AA minimum 44×44px.
  </p>
</section>`;
}
// ---------------------------------------------------------------------------
// Master render function
// ---------------------------------------------------------------------------
function renderNintendoHtml(analysis, siteTitle, breakpoints = []) {
    const vars = analysis.resolvedCssVariables;
    // Resolve primary color
    const rawPrimaryBtn = vars["--color-button"] || vars["--color-primary"] || "";
    const primaryHex = rawPrimaryBtn ? rgbCssToHex(rawPrimaryBtn) : (analysis.palette.primary[0] ?? "#000000");
    const rawPrimaryFg = vars["--color-button-text"] || "";
    const primaryFg = rawPrimaryFg ? rgbCssToHex(rawPrimaryFg) : contrastColor(primaryHex);
    const rawSecBtn = vars["--color-secondary-button"] || "";
    const secondaryBg = rawSecBtn ? rgbCssToHex(rawSecBtn) : "#ffffff";
    const rawSecFg = vars["--color-secondary-button-text"] || "";
    const secondaryFg = rawSecFg ? rgbCssToHex(rawSecFg) : primaryHex;
    const btnRadius = vars["--buttons-radius"] || analysis.buttons.radius || "4px";
    const inputRadius = vars["--inputs-radius"] || "4px";
    const bodyFamily = vars["--font-body-family"] || analysis.typography.body[0] || "sans-serif";
    const headingFamily = vars["--font-heading-family"] || analysis.typography.display[0] || bodyFamily;
    // Dominant background for hero
    const dominantBg = analysis.surfaces.find((s) => s.role === "page_canvas")?.background ||
        analysis.palette.allObserved[0]?.hex ||
        "#ffffff";
    const dominantFg = analysis.surfaces.find((s) => s.role === "page_canvas")?.text || contrastColor(dominantBg);
    const bodyFamilyCss = bodyFamily.replace(/\"/g, "'");
    const headingFamilyCss = headingFamily.replace(/\"/g, "'");
    const css = `
  *{box-sizing:border-box;}
  body{margin:0;font-family:${bodyFamilyCss},Arial,sans-serif;background:#ffffff;color:#21242e;-webkit-font-smoothing:antialiased;}
  .nav{padding:0 48px;height:64px;background:#ffffff;border-bottom:1px solid #d0d0d0;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:50;}
  .nav-brand{font-weight:700;font-size:16px;}
  .nav-cta{background:${primaryHex};color:${primaryFg};border:2px solid ${primaryHex};border-radius:${btnRadius};padding:8px 22px;font-weight:600;font-size:15px;cursor:pointer;}
  .hero{padding:96px 48px;background:${dominantBg};max-width:1440px;margin:0 auto;}
  .hero h1{font-family:${headingFamilyCss},Arial,sans-serif;font-size:64px;font-weight:700;line-height:1.05;color:${dominantFg};margin:0 0 24px;}
  .hero p{font-size:18px;color:${dominantFg};max-width:720px;margin:0 0 36px;line-height:1.5;opacity:0.85;}
  .hero-actions{display:flex;gap:12px;flex-wrap:wrap;}
  .btn-primary{background:${primaryHex};color:${primaryFg};border:2px solid ${primaryHex};border-radius:${btnRadius};height:48px;padding:0 27px;font-size:16px;font-weight:600;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;}
  .btn-secondary{background:${secondaryBg};color:${secondaryFg};border:2px solid ${primaryHex};border-radius:${btnRadius};height:48px;padding:0 27px;font-size:16px;font-weight:600;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;}
  section{padding:80px 48px;max-width:1440px;margin:0 auto;}
  .section-eyebrow{font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:#60619c;margin-bottom:8px;display:block;}
  .section-heading{font-family:${headingFamilyCss},Arial,sans-serif;font-size:36px;font-weight:700;letter-spacing:-0.5px;margin:0 0 32px;}
  .palette-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px;}
  .swatch{border:1px solid #e0e0e0;border-radius:8px;overflow:hidden;}
  .swatch-fill{height:90px;}
  .swatch-meta{padding:12px;}
  .swatch-name{font-weight:600;font-size:14px;margin:0 0 2px;}
  .swatch-hex{font-family:monospace;font-size:12px;color:#60619c;margin:0 0 6px;}
  .swatch-role{font-size:12px;color:#60619c;margin:0;line-height:1.4;}
  .type-row{display:grid;grid-template-columns:240px 1fr;gap:24px;padding:18px 0;border-top:1px solid #e0e0e0;align-items:baseline;}
  .type-meta{font-family:monospace;font-size:11px;color:#60619c;line-height:1.6;}
  .button-grid,.card-grid,.form-grid,.elevation-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:20px;}
  .demo-card{border:1px solid #e0e0e0;border-radius:12px;padding:24px;background:#ffffff;}
  .label{font-size:12px;color:#60619c;display:block;margin-bottom:12px;font-weight:600;}
  .feature-card{border:1px solid rgba(0,0,0,0.08);border-radius:12px;padding:24px;}
  .feature-card h4{margin:0 0 8px;font-size:17px;font-weight:600;}
  .feature-card p{margin:0;font-size:13px;line-height:1.5;opacity:0.75;}
  .ex-input-demo{width:100%;background:#ffffff;border:1px solid #ccc;color:#21242e;padding:10px 14px;font-family:inherit;font-size:15px;border-radius:${inputRadius};}
  .spacing-row{display:flex;gap:16px;flex-wrap:wrap;align-items:flex-end;}
  .spacing-box{background:${primaryHex};height:40px;border-radius:4px;}
  .spacing-label{font-family:monospace;font-size:11px;color:#60619c;margin-top:6px;text-align:center;}
  .radius-row{display:flex;gap:24px;flex-wrap:wrap;align-items:flex-end;}
  .radius-box{width:90px;height:90px;background:#ffffff;border:2px solid ${primaryHex};display:flex;align-items:center;justify-content:center;font-family:monospace;font-size:11px;color:#60619c;}
  .radius-label{font-family:monospace;font-size:11px;color:#60619c;margin-top:6px;text-align:center;}
  .elev-card{background:#ffffff;border:1px solid #e0e0e0;border-radius:12px;padding:24px;font-size:13px;color:#60619c;margin-bottom:4px;}
  .responsive-table{width:100%;border-collapse:collapse;font-size:14px;}
  .responsive-table th,.responsive-table td{text-align:left;padding:12px 16px;border-bottom:1px solid #e0e0e0;}
  .responsive-table th{font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#60619c;background:#f9f9f9;}
  .device-ladder{display:flex;gap:12px;align-items:flex-end;}
  .device-box{background:#ffffff;border:1px solid #e0e0e0;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:11px;color:#60619c;}
  .footer{padding:32px 48px;border-top:1px solid #e0e0e0;font-size:13px;color:#60619c;text-align:center;}
  @media(max-width:768px){section{padding:48px 20px;}.type-row{grid-template-columns:1fr;gap:8px;}.section-heading{font-size:26px;}.hero{padding:48px 20px;}.hero h1{font-size:36px;}}
  `;
    const siteHostname = (() => {
        try {
            return new URL(analysis.url).hostname;
        }
        catch {
            return analysis.url;
        }
    })();
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Design System Analysis of ${siteTitle}</title>
<style>${css}</style>
</head>
<body>
<nav class="nav">
  <span class="nav-brand">${siteTitle}</span>
  <button class="nav-cta">Design System</button>
</nav>

<div class="hero">
  <h1>Design System Analysis</h1>
  <p>Visual language extracted from <strong>${siteHostname}</strong> — colors, typography, components, spacing, and interaction patterns that define the brand experience.</p>
  <div class="hero-actions">
    <button class="btn-primary">View Components</button>
    <button class="btn-secondary">Color Tokens</button>
  </div>
</div>

${renderColorSection(analysis.palette.allObserved, primaryHex)}
${renderTypographySection(analysis.typography.scales, bodyFamily, headingFamily)}
${renderButtonSection(primaryHex, primaryFg, btnRadius, secondaryBg, secondaryFg)}
${renderSurfacesSection(analysis.surfaces)}
${renderFormSection(primaryHex, inputRadius, primaryFg)}
${renderSpacingSection(analysis.spacing)}
${renderRadiusSection(analysis.radius)}
${renderElevationSection(analysis.shadows, vars)}
${renderResponsiveSection(analysis.url, breakpoints)}

<footer class="footer">Design system analysis of ${analysis.url}</footer>
</body>
</html>`;
}
// ---------------------------------------------------------------------------
// Extract real breakpoints from scraped component DOM files
// ---------------------------------------------------------------------------
async function extractBreakpoints(runDir) {
    const compDir = (0, node_path_1.join)(runDir, "components");
    const minWidthCounts = new Map();
    try {
        const entries = await (0, promises_1.readdir)(compDir);
        for (const entry of entries) {
            const domPath = (0, node_path_1.join)(compDir, entry, "dom.html");
            try {
                const dom = await (0, promises_1.readFile)(domPath, "utf-8");
                const matches = dom.matchAll(/@media[^{]*min-width:\s*(\d+)px/gi);
                for (const m of matches) {
                    const px = parseInt(m[1], 10);
                    if (px > 320 && px < 3000) {
                        minWidthCounts.set(px, (minWidthCounts.get(px) ?? 0) + 1);
                    }
                }
            }
            catch {
                // component may not have dom.html
            }
        }
    }
    catch {
        // no components dir
    }
    // Keep breakpoints that appear in at least 2 components (noise filter)
    const significant = [...minWidthCounts.entries()]
        .filter(([, count]) => count >= 2)
        .map(([px]) => px)
        .sort((a, b) => a - b);
    if (significant.length === 0)
        return [];
    // Assign semantic names
    const names = ["Mobile", "Tablet", "Desktop", "Wide", "Ultra-wide"];
    return significant.slice(0, 5).map((px, i) => ({
        name: names[i] ?? `Breakpoint ${i + 1}`,
        minPx: px,
        changes: breakpointDescription(px),
    }));
}
function breakpointDescription(px) {
    if (px <= 480)
        return "Single-column layout; full-width touch targets; navigation collapses";
    if (px <= 768)
        return "Two-column grid unlocked; sidebar may appear; font scale increases";
    if (px <= 1024)
        return "Full navigation expanded; multi-column layouts active; container max-width starts";
    if (px <= 1280)
        return "Wider content area; larger hero padding; additional columns in grids";
    return "Max-width container centred; extra gutters added; largest type scale applied";
}
// ---------------------------------------------------------------------------
// Load from run dir and render
// ---------------------------------------------------------------------------
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
        return renderNintendoHtml(analysis, siteTitle, breakpoints);
    }
    catch {
        return null;
    }
}
