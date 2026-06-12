import type { DesignSystemData } from "./designHtmlExtractor";

// ---------------------------------------------------------------------------
// Renders a DesignSystemData object into the preview HTML format.
// Output matches the structure of the sample preview.html.
// ---------------------------------------------------------------------------

function esc(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cssVarsBlock(vars: Record<string, string>): string {
  if (!Object.keys(vars).length) return "";
  const lines = Object.entries(vars)
    .map(([k, v]) => `    ${k}:${v};`)
    .join("\n");
  return `  :root{\n${lines}\n  }`;
}

function paletteSection(palette: DesignSystemData["palette"]): string {
  const swatches = palette
    .map(
      (s) => `<div class="swatch">
  <div class="swatch-fill" style="background:${esc(s.hex)};"></div>
  <div class="swatch-meta">
    <p class="swatch-name">${esc(s.name)}</p>
    <p class="swatch-hex">${esc(s.hex)}</p>
    <p class="swatch-role">${esc(s.role)}</p>
  </div>
</div>`
    )
    .join("\n");
  return `<section>
  <span class="section-eyebrow">01 — Foundations</span>
  <h2 class="section-heading">Color Palette</h2>
  <div class="palette-grid">${swatches}</div>
</section>`;
}

function typographySection(typography: DesignSystemData["typography"]): string {
  const rows = typography.rows
    .map((r) => {
      const styleStr = Object.entries(r.previewStyles)
        .map(([k, v]) => `${k}:${v}`)
        .join(";");
      return `<div class="type-row">
  <div class="type-meta">${esc(r.role)}<br>${esc(r.spec)}<br>lh ${esc(r.lineHeight)} · ls ${esc(r.letterSpacing)}<br><span style="color:#888;">${esc(r.usage)}</span></div>
  <div style="${esc(styleStr)}">${esc(r.previewText)}</div>
</div>`;
    })
    .join("\n");
  return `<section>
  <span class="section-eyebrow">02 — Foundations</span>
  <h2 class="section-heading">Typography</h2>
  <p style="color:#60619c;margin:-16px 0 28px;max-width:720px;">${esc(typography.note)}</p>
  ${rows}
</section>`;
}

function buttonsSection(buttons: DesignSystemData["buttons"]): string {
  const cards = buttons
    .map(
      (b) => `<div class="demo-card">
  <span class="label">${esc(b.label)}</span>
  ${b.buttonHtml}
  <p style="font-size:12px;color:#60619c;margin:12px 0 0;">${esc(b.description)}</p>
</div>`
    )
    .join("\n");
  return `<section>
  <span class="section-eyebrow">03 — Components</span>
  <h2 class="section-heading">Button Variants</h2>
  <div class="button-grid">${cards}</div>
</section>`;
}

function surfacesSection(surfaces: DesignSystemData["surfaces"]): string {
  const cards = surfaces
    .map((s) => {
      const colorStyle = s.textColor && s.textColor !== "#21242e"
        ? `color:${esc(s.textColor)};border:none;`
        : "";
      return `<div class="feature-card" style="background:${esc(s.backgroundHex)};${colorStyle}">
  <h4${s.textColor && s.textColor !== "#21242e" ? ` style="color:${esc(s.textColor)};"` : ""}>${esc(s.title)}</h4>
  <p${s.textColor && s.textColor !== "#21242e" ? ` style="color:${esc(s.textColor)};opacity:0.7;"` : ""}>${esc(s.description)}</p>
</div>`;
    })
    .join("\n");
  return `<section>
  <span class="section-eyebrow">04 — Components</span>
  <h2 class="section-heading">Cards &amp; Surfaces</h2>
  <div class="card-grid">${cards}</div>
</section>`;
}

function formsSection(forms: DesignSystemData["forms"]): string {
  const cards = forms
    .map(
      (f) => `<div class="demo-card">
  <span class="label">${esc(f.label)}</span>
  ${f.elementHtml}
</div>`
    )
    .join("\n");
  return `<section>
  <span class="section-eyebrow">05 — Components</span>
  <h2 class="section-heading">Form Elements</h2>
  <div class="form-grid">${cards}</div>
</section>`;
}

function spacingSection(spacing: DesignSystemData["spacing"]): string {
  const boxes = spacing.tokens
    .map(
      (t) => `<div>
  <div class="spacing-box" style="width:${t.widthPx}px;"></div>
  <div class="spacing-label">${esc(t.name)}<br>${esc(t.value)}</div>
</div>`
    )
    .join("\n");
  return `<section>
  <span class="section-eyebrow">06 — Foundations</span>
  <h2 class="section-heading">Spacing Scale</h2>
  <p style="color:#60619c;margin:-16px 0 28px;">${esc(spacing.note)}</p>
  <div class="spacing-row">${boxes}</div>
</section>`;
}

function radiusSection(radius: DesignSystemData["radius"]): string {
  const boxes = radius.tokens
    .map(
      (t) => `<div>
  <div class="radius-box" style="border-radius:${esc(t.value)};">${esc(t.value)}</div>
  <div class="radius-label">${esc(t.name)}</div>
</div>`
    )
    .join("\n");
  return `<section>
  <span class="section-eyebrow">07 — Foundations</span>
  <h2 class="section-heading">Border Radius</h2>
  <p style="color:#60619c;margin:-16px 0 28px;">${esc(radius.note)}</p>
  <div class="radius-row">${boxes}</div>
</section>`;
}

function elevationSection(elevation: DesignSystemData["elevation"]): string {
  const cards = elevation
    .map((e, i) => {
      const styleStr = Object.entries(e.styles)
        .map(([k, v]) => `${k}:${v}`)
        .join(";");
      return `<div class="elev-card elev-${i + 1}" style="${esc(styleStr)}">${esc(e.description)}</div>`;
    })
    .join("\n");
  return `<section>
  <span class="section-eyebrow">08 — Foundations</span>
  <h2 class="section-heading">Elevation &amp; Depth</h2>
  <div class="elevation-grid">${cards}</div>
</section>`;
}

function responsiveSection(responsive: DesignSystemData["responsive"]): string {
  const rows = responsive.breakpoints
    .map(
      (b) => `<tr>
  <td>${esc(b.name)}</td>
  <td>${esc(b.width)}</td>
  <td>${esc(b.changes)}</td>
</tr>`
    )
    .join("\n");
  return `<section>
  <span class="section-eyebrow">09 — Responsive</span>
  <h2 class="section-heading">Responsive Behavior</h2>
  <table class="responsive-table">
    <thead><tr><th>Name</th><th>Width</th><th>Key changes</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p style="color:#60619c;margin-top:24px;font-size:14px;">${esc(responsive.touchNote)}</p>
</section>`;
}

// ---------------------------------------------------------------------------
// Main render function
// ---------------------------------------------------------------------------
export function renderDesignHtml(data: DesignSystemData): string {
  const {
    meta,
    nav,
    hero,
    palette,
    typography,
    buttons,
    surfaces,
    forms,
    spacing,
    radius,
    elevation,
    responsive,
    cssVariables,
  } = data;

  const navLinks = nav.links.map((l) => `<li>${esc(l)}</li>`).join("");
  const varsBlock = cssVarsBlock(cssVariables);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>${esc(meta.title)}</title>
  <style>
  *{box-sizing:border-box;}
  body{margin:0;font-family:'Arial','Inter','Helvetica Neue',Arial,sans-serif;background:#ffffff;color:#21242e;-webkit-font-smoothing:antialiased;}
  .nav{padding:0 48px;height:64px;background:#ffffff;border-bottom:1px solid #b3b9d6;position:sticky;top:0;z-index:50;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;}
  .nav-brand{font-weight:700;font-size:16px;}
  .nav-links{list-style:none;display:flex;gap:28px;margin:0;padding:0;font-size:15px;font-weight:500;justify-self:center;}
  .nav-cta{background:var(--color-primary,#ecab37);color:#21242e;border:2px solid var(--color-primary,#ecab37);border-radius:2px;padding:8px 22px;font-weight:600;font-size:15px;cursor:pointer;font-family:inherit;justify-self:end;}
  .hero{padding:96px 48px;background:${esc(hero.backgroundHex || "var(--color-canvas,#7a8aba)")};max-width:1440px;margin:0 auto;display:block;}
  .hero-content{max-width:1200px;}
  .hero h1{font-family:'Arial Black',Arial,sans-serif;font-size:72px;font-weight:900;line-height:1.05;color:#21242e;margin:0 0 32px;letter-spacing:-1.3px;}
  .hero p{font-size:19px;color:#21242e;max-width:840px;margin:0 0 36px;line-height:1.5;}
  .hero-actions{display:flex;gap:12px;flex-wrap:wrap;}
  .btn-primary{background:var(--color-primary,#ecab37);color:#21242e;border:2px solid var(--color-primary,#ecab37);border-radius:2px;height:48px;padding:0 27px;font-size:16px;font-weight:600;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;justify-content:center;}
  .btn-secondary{background:#ffffff;color:#21242e;border:1px solid #b3b9d6;border-radius:2px;height:48px;padding:0 27px;font-size:16px;font-weight:600;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;justify-content:center;}
  section{padding:80px 48px;max-width:1440px;margin:0 auto;}
  .section-eyebrow{font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:#60619c;margin-bottom:8px;}
  .section-heading{font-family:'Arial Black',Arial,sans-serif;font-size:36px;font-weight:900;letter-spacing:-1px;margin:0 0 32px;}
  .palette-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px;}
  .swatch{border:1px solid #b3b9d6;border-radius:8px;overflow:hidden;}
  .swatch-fill{height:90px;}
  .swatch-meta{padding:12px;}
  .swatch-name{font-weight:600;font-size:14px;margin:0 0 2px;}
  .swatch-hex{font-family:monospace;font-size:12px;color:#60619c;margin:0 0 6px;}
  .swatch-role{font-size:12px;color:#60619c;margin:0;line-height:1.4;}
  .type-row{display:grid;grid-template-columns:240px 1fr;gap:24px;padding:18px 0;border-top:1px solid #b3b9d6;align-items:baseline;}
  .type-meta{font-family:monospace;font-size:11px;color:#60619c;line-height:1.5;}
  .button-grid,.card-grid,.form-grid,.elevation-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:20px;}
  .demo-card{border:1px solid #b3b9d6;border-radius:12px;padding:24px;background:#ffffff;}
  .label{font-size:12px;color:#60619c;display:block;margin-bottom:12px;font-weight:600;}
  .feature-card{background:#ffffff;border:1px solid #b3b9d6;border-radius:16px;padding:24px;}
  .feature-card h4{margin:0 0 8px;font-size:19px;font-weight:600;}
  .feature-card p{margin:0;color:#60619c;font-size:14px;line-height:1.5;}
  .ex-input-demo{width:100%;background:#ffffff;border:1px solid #b3b9d6;color:#21242e;padding:12px 16px;font-family:inherit;font-size:15px;border-radius:0;}
  .spacing-row,.radius-row{display:flex;gap:16px;flex-wrap:wrap;align-items:flex-end;}
  .spacing-box{background:var(--color-primary,#ecab37);height:40px;border-radius:6px;}
  .spacing-label,.radius-label{font-family:monospace;font-size:11px;color:#60619c;margin-top:6px;text-align:center;}
  .radius-box{width:90px;height:90px;background:#ffffff;border:2px solid #21242e;display:flex;align-items:center;justify-content:center;font-family:monospace;font-size:11px;}
  .elev-card{background:#ffffff;border:1px solid #b3b9d6;border-radius:12px;padding:24px;font-size:13px;color:#60619c;}
  .responsive-table{width:100%;border-collapse:collapse;font-size:14px;}
  .responsive-table th,.responsive-table td{text-align:left;padding:12px 16px;border-bottom:1px solid #b3b9d6;}
  .responsive-table th{font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#60619c;}
  .footer{padding:32px 48px;border-top:1px solid #b3b9d6;font-size:13px;color:#60619c;text-align:center;}
  @media(max-width:1024px){section{padding:64px 32px;}.section-heading{font-size:28px;}.type-row{grid-template-columns:1fr;gap:8px;}}
  @media(max-width:720px){.nav{padding:12px 20px;height:auto;min-height:56px;}.nav-links{display:none;}.hero{padding:48px 20px;}.hero h1{font-size:38px;}.hero p{font-size:16px;}section{padding:48px 20px;}.section-heading{font-size:24px;}.palette-grid,.button-grid,.card-grid,.form-grid,.elevation-grid{grid-template-columns:1fr !important;}}
  ${varsBlock}
  </style>
</head>
<body>

<nav class="nav">
  <div class="nav-left">
    <span class="nav-brand">${esc(nav.brand)}</span>
  </div>
  <ul class="nav-links">${navLinks}</ul>
  <button class="nav-cta">${esc(nav.ctaText)}</button>
</nav>

<div class="hero">
  <div class="hero-content">
    <h1>${esc(hero.heading)}</h1>
    <p>${esc(hero.body)}</p>
    <div class="hero-actions">
      <button class="btn-primary">${esc(hero.primaryCta)}</button>
      ${hero.secondaryCta ? `<button class="btn-secondary">${esc(hero.secondaryCta)}</button>` : ""}
    </div>
  </div>
</div>

${palette.length ? paletteSection(palette) : ""}
${typography.rows.length ? typographySection(typography) : ""}
${buttons.length ? buttonsSection(buttons) : ""}
${surfaces.length ? surfacesSection(surfaces) : ""}
${forms.length ? formsSection(forms) : ""}
${spacing.tokens.length ? spacingSection(spacing) : ""}
${radius.tokens.length ? radiusSection(radius) : ""}
${elevation.length ? elevationSection(elevation) : ""}
${responsive.breakpoints.length ? responsiveSection(responsive) : ""}

<footer class="footer">Generated by getdesign.md</footer>

</body>
</html>`;
}
