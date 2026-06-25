# getmd.design — Chrome Extension PRD

**Version:** 1.0  
**Status:** Draft  
**Date:** June 2026  
**Author:** Goutham Sankar

---

## 1. Overview

| Field | Value |
|---|---|
| Product | getmd.design Chrome Extension |
| Platform | Chrome (Manifest V3) |
| Target Users | Designers & Developers |

A Chrome extension that lets users generate a DESIGN.md file for any website they're currently browsing — one click from the active tab, no copy-pasting URLs. The extension surfaces the generation progress, links to the result on getmd.design, and optionally shows a quick inline design summary without leaving the page.

---

## 2. Problem

**Friction in the current flow**  
Users must manually copy a URL, open getmd.design, paste it in the hero input, and wait. If they're browsing and spot a site they like, the context switch kills the momentum.

**No ambient discovery**  
There's no way to know if a site has already been scraped without visiting the library. Users re-submit sites that are already in the library, wasting queue capacity.

**No design-at-a-glance**  
Even after generation, users have to navigate to the library page to see any result. A quick inline summary (colours, fonts) would be valuable without a full page visit.

---

## 3. User Stories

- **As a designer browsing a competitor's site,** I want to generate its DESIGN.md in one click so I can analyse their visual language without leaving my workflow.
- **As a developer referencing a design system,** I want to see if a site is already in the library instantly, so I don't wait for a redundant scrape.
- **As a user who submitted a scrape,** I want to see live progress in the extension popup so I don't have to keep checking the website.
- **As a signed-out user,** I want to be prompted to sign in with Google in the popup itself, without being redirected away.

---

## 4. Features

### P0 — Must Have

**One-Click Generate**
- Auto-fills current tab URL
- Submits to `/api/public/scrape`
- Shows live SSE progress bar
- Opens result on completion

**Already in Library Badge**
- Checks `/api/public/runs/{slug}/status` on popup open
- Shows "View DESIGN.md" if already cached
- Toolbar icon gets a green dot badge for cached sites
- Instant — no extra wait

**Inline Auth**
- Google sign-in inside the popup (no redirect)
- Firebase Auth via `chrome.identity`
- Persists session across tabs
- Sign-out option in popup

### P1 — Should Have

**Design Quick-Peek**
- Colour palette swatches
- Font family names
- Category tag
- Link to full DESIGN.md on the library page

**Right-Click Any Site**
- Context menu item: "Generate DESIGN.md"
- Works on any link, not just the current tab
- Opens popup with that URL pre-filled

### P2 — Nice to Have

**My Scrapes History**
- Lists the user's past runs
- Status + screenshot thumbnail per run
- Calls `/api/public/runs/mine`
- Quick-link to the library page

**Background Notifications**
- Chrome notification on scrape complete — even when popup is closed
- Service worker maintains SSE connection in background
- Click notification to open the result

**Omnibox Shortcut**
- Type `gmd <url>` in the Chrome address bar
- Triggers scrape directly — no popup needed

---

## 5. Architecture

| Layer | Details |
|---|---|
| **Popup UI** | React + Vite. Three views: `Auth`, `Generate`, `History`. Shares the same `api.ts` client from probe. Talks to backend via `BACKEND_URL` env var. |
| **Service Worker** | MV3 background script. Holds SSE connection when popup closes. Posts `chrome.notifications` on completion. Caches auth token via `chrome.storage.local`. |
| **Content Script** | Injected only on demand (not all pages). Reads `document.title` + canonical URL to disambiguate SPAs. Optional: floating "Generate" pill on hover. |
| **Auth** | Firebase Auth via `chrome.identity.getAuthToken` (OAuth2). ID token passed as `Authorization: Bearer` header — same as the web app. No new backend changes needed. |
| **Backend** | Zero changes needed for P0. P2 notifications need SSE keepalive beyond 2 min — or switch to polling in the service worker. |

---

## 6. Milestones

| Phase | Scope | Deliverable | Est. |
|---|---|---|---|
| M1 — Shell | P0 | Popup with auth, URL auto-fill, submit button, SSE progress, redirect on complete | 1 week |
| M2 — Library Check | P0 | Badge icon, "View DESIGN.md" fast path, toolbar green dot for cached sites | 3 days |
| M3 — Quick-Peek | P1 | Design summary panel (colours, fonts, category) inside popup for cached runs | 4 days |
| M4 — Context Menu | P1 | Right-click any link → generate for that URL | 2 days |
| M5 — Notifications | P2 | Background SSE via service worker, Chrome notification on job complete | 1 week |
| M6 — History + Omnibox | P2 | My runs panel, omnibox `gmd` keyword trigger | 1 week |
| M7 — Store Release | — | Chrome Web Store listing, privacy policy, screenshots | 3 days |

---

## 7. Technical Specs

| Spec | Value |
|---|---|
| Manifest version | V3 (required for Chrome Store 2024+) |
| Build tool | Vite + CRXJS plugin |
| UI framework | React 18, same design tokens as probe |
| Auth flow | `chrome.identity.launchWebAuthFlow` → Firebase ID token |
| Token storage | `chrome.storage.local` (encrypted on device) |
| SSE in background | Service worker with keepalive ping via `chrome.alarms` |
| Permissions needed | `activeTab`, `storage`, `identity`, `notifications`, `contextMenus` |
| Host permissions | Backend URL only — no broad `host_permissions` |
| Popup size | 360 × 480px |
| Code location | New package: `/extension/` at repo root |

---

## 8. Success Metrics

| Metric | Target |
|---|---|
| Installs @ Month 1 | 500 |
| D7 Retention | 40% |
| Scrapes via extension (% of total) | 30% |
| Chrome Web Store rating | 4.5★ |

---

## 9. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| SSE in MV3 service worker | High | Service workers terminate after 30s of inactivity. Use `chrome.alarms` to keep alive, or fall back to polling `/status` every 5s. |
| Firebase Auth in extension | Medium | Firebase SDK uses `localStorage` — unavailable in service worker. Use `chrome.identity.getAuthToken` and exchange for a Firebase custom token. |
| Chrome Store review delay | Medium | Allow 2–3 weeks for first submission. Submit M1+M2 scope only to reduce rejection surface area. |
| CORS on backend | Low | Extension origin is `chrome-extension://...` — add it to allowed CORS origins in Express, or use a wildcard for extension IDs in dev. |

---

## 10. Out of Scope (v1)

- Firefox / Safari extension port
- Injecting UI overlays directly onto third-party pages
- Offline mode
- Team / org sharing from the extension
- Admin actions from the extension
