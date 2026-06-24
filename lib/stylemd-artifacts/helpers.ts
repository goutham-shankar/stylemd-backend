import {
  STYLEMD_PIPELINE_STAGES,
  type StyleMdArtifactRecord,
  type StyleMdPipelineStageName,
  type StyleMdProvider,
  type StyleMdRunState,
  type StyleMdStageState,
} from "@/lib/stylemd-artifacts/types";

export class StyleMdPipelineAbortedError extends Error {
  public constructor(message = "Style artifact pipeline canceled") {
    super(message);
    this.name = "StyleMdPipelineAbortedError";
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function makeRunId(): string {
  return `stylemd_${Date.now()}`;
}

export function createInitialStages(): StyleMdStageState[] {
  return STYLEMD_PIPELINE_STAGES.map((stage) => ({
    stage,
    status: "pending",
  }));
}

export function createInitialRunState(
  runId: string,
  url: string,
  provider: StyleMdProvider,
  model: string,
): StyleMdRunState {
  const startedAt = nowIso();
  return {
    runId,
    provider,
    model,
    url,
    status: "running",
    startedAt,
    warnings: [],
    stages: createInitialStages(),
    artifacts: [],
    metrics: {
      candidateCount: 0,
      extractedComponents: 0,
      dedupedComponents: 0,
      duplicatesDeleted: 0,
      curatedUnits: 0,
      curatedComponents: 0,
      curationDeleted: 0,
    },
    showcase: {
      available: false,
      canonicalUrl: `/styleguide/${runId}`,
      latestUrl: "/styleguide",
    },
  };
}

export function mergeArtifact(
  artifacts: StyleMdArtifactRecord[],
  artifact: StyleMdArtifactRecord,
): StyleMdArtifactRecord[] {
  const withoutExisting = artifacts.filter((item) => item.path !== artifact.path);
  withoutExisting.push(artifact);
  return withoutExisting;
}

export function updateRunState(
  state: StyleMdRunState,
  patch: Partial<StyleMdRunState>,
): StyleMdRunState {
  return {
    ...state,
    ...patch,
  };
}

export function updateStageState(
  state: StyleMdRunState,
  stage: StyleMdPipelineStageName,
  patch: Partial<StyleMdStageState>,
): StyleMdRunState {
  return {
    ...state,
    stages: state.stages.map((item) => {
      if (item.stage !== stage) {
        return item;
      }
      return {
        ...item,
        ...patch,
      };
    }),
  };
}

export function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new StyleMdPipelineAbortedError();
  }
}

export function errorToMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function isAbortError(error: unknown): boolean {
  // Explicit pipeline cancellation
  if (error instanceof StyleMdPipelineAbortedError) return true;

  if (error instanceof Error) {
    // Web API AbortError (fetch, EventSource, etc.)
    if (error.name === "AbortError") return true;
    // Node.js / Playwright AbortError subclass
    if (error.constructor?.name === "AbortError") return true;
  }

  // Do NOT match "abort" or "cancel" in the error *message* — Playwright throws
  // errors like "net::ERR_ABORTED" or "Navigation was aborted" for network-level
  // failures that are NOT intentional pipeline cancellations. Broad message
  // matching causes real failures to be silently classified as "canceled".
  return false;
}

export function getPlaywrightLaunchOptions() {
  const isProduction = process.env.NODE_ENV === "production";

  const options: any = {
    headless: true,
    args: [
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
    ],
  };

  // If in production or explicit path provided, use system Chrome
  if (isProduction || process.env.PLAYWRIGHT_CHROME_PATH) {
    options.executablePath = process.env.PLAYWRIGHT_CHROME_PATH || "/usr/bin/google-chrome";
    options.args.push("--no-sandbox", "--disable-setuid-sandbox");
  }

  return options;
}

// ---------------------------------------------------------------------------
// Shared screenshot-preparation helpers (used by scraper + voltResolver)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PlaywrightPage = any;

const DISMISS_SELECTORS = [
  '#onetrust-accept-btn-handler',
  '#onetrust-reject-all-handler',
  '.ot-sdk-btn.ot-reject-all',
  '#truste-consent-button',
  '#CybotCookiebotDialogBodyButtonAccept',
  '#CybotCookiebotDialogBodyLevelButtonAccept',
  '[data-testid="cookie-policy-dialog-accept-button"]',
  '[class*="cookie"] button:text-matches("agree|accept|allow|got it|ok", "i")',
  '[class*="consent"] button:text-matches("agree|accept|allow|got it|ok", "i")',
  '[class*="gdpr"] button:text-matches("agree|accept|allow|got it|ok", "i")',
  '[id*="cookie"] button:text-matches("agree|accept|allow|got it|ok", "i")',
  '[id*="consent"] button:text-matches("agree|accept|allow|got it|ok", "i")',
  '[class*="cookie"] button:text-matches("reject|decline|refuse|close|no thanks", "i")',
  '[class*="consent"] button:text-matches("reject|decline|refuse|close|no thanks", "i")',
  '[role="dialog"] button[aria-label*="close" i]',
  '[class*="modal"] button[aria-label*="close" i]',
  '[class*="popup"] button[aria-label*="close" i]',
];

export async function injectStealth(page: PlaywrightPage): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
    (window as any).chrome = { runtime: {}, loadTimes: () => ({}), csi: () => ({}) };
    const originalQuery = (window as any).navigator.permissions?.query;
    if (originalQuery) {
      (window as any).navigator.permissions.query = (params: any) =>
        params.name === "notifications"
          ? Promise.resolve({ state: Notification.permission })
          : originalQuery(params);
    }
    Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
  });
}

export async function dismissOverlays(page: PlaywrightPage): Promise<void> {
  const runDismiss = async () => {
    await Promise.allSettled(
      DISMISS_SELECTORS.map(async (sel) => {
        try {
          const el = page.locator(sel).first();
          if (await el.isVisible({ timeout: 150 })) {
            await el.click({ timeout: 800 });
          }
        } catch { /* not present — skip */ }
      })
    );
  };

  await runDismiss();
  await page.waitForTimeout(1500);
  await runDismiss();
}

export async function hideJunkBeforeScreenshot(page: PlaywrightPage): Promise<void> {
  await page.evaluate(() => {
    const style = document.createElement("style");
    style.textContent = [
      // Chat widgets
      '#intercom-container', '#intercom-frame', '[class*="intercom"]',
      '#drift-widget', '#drift-frame', '[class*="drift-"]',
      '#hubspot-messages-iframe-container', '[class*="hubspot-messages"]',
      '#beacon-container', '.BeaconFabButtonFrame',
      '#tawk-bubble-container', '#tawk-container', '[class*="tawk-"]',
      '#fc_frame', '#fc-widget', '[class*="freshchat"]',
      '#crisp-chatbox', '[class*="crisp-"]',
      '#tidio-chat', '#tidio-chat-iframe',
      '[class*="zsiq"], #zsiq_float', // Zoho SalesIQ
      '#launcher', '[class*="zE-widget"]', // Zendesk
      // Scroll-to-top buttons
      '[class*="scroll-to-top"]', '[class*="back-to-top"]', '[class*="scrollToTop"]',
      '[id*="scroll-to-top"]', '[id*="back-to-top"]', '[id*="scrollToTop"]',
      'button[aria-label*="scroll to top" i]', 'a[aria-label*="back to top" i]',
      // Cookie backdrop remnants
      '[class*="overlay"][style*="position: fixed"]',
      '[class*="cookie"][style*="position: fixed"]',
      '[class*="consent"][style*="position: fixed"]',
    ].map(s => `${s}{display:none!important;visibility:hidden!important;}`).join('\n');
    document.head.appendChild(style);

    // Pause all <video> elements to freeze on a clean frame
    document.querySelectorAll('video').forEach(v => {
      v.pause();
      v.style.objectPosition = 'center top';
    });
  });
}

export async function scrollAndSettle(page: PlaywrightPage): Promise<void> {
  await page.evaluate(async () => {
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
    const vh = Math.max(window.innerHeight, 1);
    const step = Math.max(500, Math.floor(vh * 0.85));
    let maxScroll = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);

    // Scroll down in chunks to trigger lazy loading + IntersectionObserver
    for (let y = 0; y < maxScroll; y += step) {
      window.scrollTo(0, y);
      await sleep(80);
      maxScroll = Math.max(maxScroll, document.body.scrollHeight, document.documentElement.scrollHeight);
    }
    window.scrollTo(0, maxScroll);
    await sleep(200);

    // Scroll back to top
    window.scrollTo(0, 0);
    await sleep(300);
  });
}

export async function waitForAssets(page: PlaywrightPage): Promise<void> {
  // Fonts
  await page.evaluate(() => document.fonts.ready).catch(() => undefined);

  // Viewport images — race against a 4s ceiling
  await Promise.race([
    page.evaluate(() => {
      const imgs = Array.from(document.images).filter((img) => {
        const r = img.getBoundingClientRect();
        return r.top < window.innerHeight * 2 && r.bottom > -100;
      });
      return Promise.all(
        imgs.map((img) =>
          img.complete
            ? Promise.resolve()
            : new Promise<void>((resolve) => {
                img.addEventListener("load", () => resolve(), { once: true });
                img.addEventListener("error", () => resolve(), { once: true });
              })
        )
      );
    }).catch(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, 4000)),
  ]);

  // Trigger any CSS animations that use opacity:0 as initial state
  await page.evaluate(() => {
    document.querySelectorAll<HTMLElement>('*').forEach((el) => {
      const style = window.getComputedStyle(el);
      if (style.opacity === '0' && style.animationName && style.animationName !== 'none') {
        el.style.animationDelay = '0s';
        el.style.animationDuration = '0s';
        el.style.animationFillMode = 'forwards';
      }
    });
  }).catch(() => undefined);
}

/**
 * Correlated logging for pipeline tracing.
 */
export function runIdLog(runId: string, message: string, level: "info" | "warn" | "error" | "debug" = "info") {
  const prefix = `[runId=${runId}]`;
  const fullMessage = `${prefix} ${message}`;
  
  switch (level) {
    case "error": console.error(fullMessage); break;
    case "warn": console.warn(fullMessage); break;
    default: console.log(fullMessage); break;
  }
}
