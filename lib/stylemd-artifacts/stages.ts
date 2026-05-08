import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import { basename, dirname, extname, join, relative } from "node:path";
import sharp from "sharp";
import { ssim } from "ssim.js";
import type { CDPSession, Page } from "playwright";
import {
  getStyleMdRunDir,
  writeStyleMdBinary,
  writeStyleMdImage,
  writeStyleMdJson,
  writeStyleMdText,
} from "@/lib/stylemd-artifacts/artifacts";
import { assertNotAborted, runIdLog } from "@/lib/stylemd-artifacts/helpers";
import type {
  StyleMdArtifactRecord,
  StyleMdCandidate,
  StyleMdCaptureResult,
  StyleMdComponentEntry,
  StyleMdCuratedManifest,
  StyleMdDedupResult,
  StyleMdDuplicatePair,
  StyleMdExtractResult,
  StyleMdFontManifest,
  StyleMdFontManifestEntry,
  StyleMdDesignTokenManifest,
  StyleMdSemanticStructure,
  StyleMdSemanticSection,
  StyleMdPipelineConfig,
  StyleMdResponsiveHoverEvidence,
  StyleMdStylesheetBundle,
} from "@/lib/stylemd-artifacts/types";

const FULL_WIDTH_TAGS = [
  "header",
  "section",
  "article",
  "main",
  "footer",
  "nav",
  "aside",
  "form",
  "div",
];

const STYLE_TREE_PROPERTIES = [
  "display",
  "position",
  "z-index",
  "top",
  "right",
  "bottom",
  "left",
  "width",
  "height",
  "min-width",
  "max-width",
  "min-height",
  "max-height",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "border-top-style",
  "border-right-style",
  "border-bottom-style",
  "border-left-style",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "border-radius",
  "box-shadow",
  "background",
  "background-image",
  "background-size",
  "background-position",
  "background-repeat",
  "opacity",
  "overflow",
  "overflow-x",
  "overflow-y",
  "color",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "line-height",
  "letter-spacing",
  "text-align",
  "text-transform",
  "text-decoration",
  "white-space",
  "word-break",
  "justify-content",
  "align-items",
  "align-content",
  "flex-direction",
  "flex-wrap",
  "flex-grow",
  "flex-shrink",
  "flex-basis",
  "gap",
  "row-gap",
  "column-gap",
  "grid-template-columns",
  "grid-template-rows",
  "grid-auto-flow",
  "transform",
  "transform-origin",
  "transition",
  "animation",
] as const;

const AGENT_STYLE_PROPERTIES = [
  "display",
  "position",
  "z-index",
  "top",
  "right",
  "bottom",
  "left",
  "width",
  "height",
  "min-width",
  "max-width",
  "min-height",
  "max-height",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "border-top-style",
  "border-right-style",
  "border-bottom-style",
  "border-left-style",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "border-radius",
  "box-shadow",
  "background-color",
  "background-image",
  "background-size",
  "background-position",
  "background-repeat",
  "opacity",
  "overflow",
  "overflow-x",
  "overflow-y",
  "color",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "line-height",
  "letter-spacing",
  "text-align",
  "text-transform",
  "text-decoration",
  "white-space",
  "word-break",
  "justify-content",
  "align-items",
  "align-content",
  "flex-direction",
  "flex-wrap",
  "flex-grow",
  "flex-shrink",
  "flex-basis",
  "gap",
  "row-gap",
  "column-gap",
  "grid-template-columns",
  "grid-template-rows",
  "grid-auto-flow",
  "transform",
  "transform-origin",
  "transition",
  "animation",
] as const;

const STYLEMD_SCREENSHOT_DOWNSAMPLE_RATIO = 0.7;
const STYLEMD_SCREENSHOT_MAX_WIDTH = 1800;
const STYLEMD_SCREENSHOT_MAX_HEIGHT = 5000;

const PSEUDO_CRITICAL_PROPERTIES = [
  "content",
  ...AGENT_STYLE_PROPERTIES,
] as const;

const STYLEMD_OVERLAY_HIDE_ATTR = "data-stylemd-hidden-overlay";
const STYLEMD_OVERLAY_HIDE_STYLE_ID = "stylemd-hidden-overlay-style";
const STYLEMD_OVERLAY_GUARD_KEY = "__stylemdOverlayGuard__";
const STYLEMD_CHROME_HIDE_ATTR = "data-stylemd-hidden-chrome";
const STYLEMD_CHROME_HIDE_STYLE_ID = "stylemd-hidden-chrome-style";

type StageOutput<T> = {
  result: T;
  artifacts: StyleMdArtifactRecord[];
};

function toRunRelative(runId: string, absolutePath: string): string {
  const runDir = getStyleMdRunDir(runId);
  return relative(runDir, absolutePath).split("\\").join("/");
}

type ComponentExtractPayload = {
  found: boolean;
  reason?: string;
  selector?: string;
  tagName?: string;
  rect?: {
    top: number;
    left: number;
    width: number;
    height: number;
    bottom: number;
  };
  domHtml?: string;
  computedStyles?: Record<string, string>;
  pseudoStyles?: {
    before: Record<string, string>;
    after: Record<string, string>;
  };
  agentDomHtml?: string;
  agentStyles?: Record<string, string>;
  agentPseudoStyles?: {
    before: Record<string, string>;
    after: Record<string, string>;
  };
  styleTree?: Array<{
    nodePath: string;
    tagName: string;
    id: string | null;
    className: string;
    textSample: string;
    rect: {
      top: number;
      left: number;
      width: number;
      height: number;
      bottom: number;
    };
    styles: Record<string, string>;
  }>;
  agentStyleTree?: Array<{
    nodePath: string;
    tagName: string;
    id: string | null;
    className: string;
    textSample: string;
    rect: {
      top: number;
      left: number;
      width: number;
      height: number;
      bottom: number;
    };
    styles: Record<string, string>;
  }>;
  cssRuleRefs?: Array<{
    stylesheetIndex: number;
    stylesheetHref: string | null;
    selectorText: string;
    cssText: string;
  }>;
  metadata?: {
    subtreeElementCount: number;
    textLength: number;
  };
};

type RawImageData = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
};

async function waitForSettledPage(page: Page, signal: AbortSignal): Promise<void> {
  assertNotAborted(signal);

  await page.waitForLoadState("domcontentloaded", { timeout: 20_000 });
  await page.waitForLoadState("load", { timeout: 15_000 }).catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
  await page.waitForTimeout(400);

  assertNotAborted(signal);

  await page.evaluate(async () => {
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    const waitForFonts = async (timeoutMs: number): Promise<void> => {
      const fontSet = document.fonts;
      if (!fontSet?.ready) {
        return;
      }
      try {
        await Promise.race([
          fontSet.ready,
          sleep(timeoutMs),
        ]);
      } catch {
        // Best-effort only. Missing/failed fonts should not crash capture.
      }
    };

    const waitForImages = async (timeoutMs: number): Promise<void> => {
      const images = Array.from(document.images ?? []);
      if (images.length === 0) {
        return;
      }

      const deadline = Date.now() + timeoutMs;
      for (const image of images) {
        if (image.complete) {
          continue;
        }

        const remaining = Math.max(50, deadline - Date.now());
        if (remaining <= 50) {
          break;
        }

        const eventPromise = new Promise<void>((resolve) => {
          const done = () => resolve();
          image.addEventListener("load", done, { once: true });
          image.addEventListener("error", done, { once: true });
        });

        const decodePromise =
          typeof image.decode === "function" ? image.decode().then(() => undefined).catch(() => undefined) : Promise.resolve();

        await Promise.race([
          Promise.all([eventPromise, decodePromise]).then(() => undefined),
          sleep(remaining),
        ]);
      }
    };

    const viewportHeight = Math.max(window.innerHeight, document.documentElement.clientHeight, 1);
    const step = Math.max(500, Math.floor(viewportHeight * 0.85));
    let maxScroll = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);

    for (let position = 0; position < maxScroll; position += step) {
      window.scrollTo(0, position);
      await sleep(90);
      maxScroll = Math.max(maxScroll, document.body.scrollHeight, document.documentElement.scrollHeight);
    }

    window.scrollTo(0, maxScroll);
    await sleep(220);

    await waitForFonts(2_500);
    await waitForImages(6_000);

    const metric = (): string => {
      const height = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
      const pendingImages = Array.from(document.images ?? []).filter((image) => !image.complete).length;
      const fontStatus = document.fonts?.status ?? "unknown";
      return `${height}:${pendingImages}:${fontStatus}`;
    };

    let stableFrames = 0;
    let lastMetric = metric();
    const stabilityDeadline = Date.now() + 1_800;
    while (Date.now() < stabilityDeadline && stableFrames < 3) {
      await sleep(120);
      const nextMetric = metric();
      if (nextMetric === lastMetric) {
        stableFrames += 1;
      } else {
        stableFrames = 0;
        lastMetric = nextMetric;
      }
    }

    window.scrollTo(0, 0);
    await sleep(180);

    await waitForFonts(1_500);
    await waitForImages(2_500);
  });

  assertNotAborted(signal);

  await page.waitForLoadState("networkidle", { timeout: 6_000 }).catch(() => undefined);
  await page.waitForTimeout(200);
  assertNotAborted(signal);
}

async function runOverlayHygiene(page: Page, signal: AbortSignal): Promise<void> {
  assertNotAborted(signal);

  await page.evaluate(
    ({ hideAttr, styleId, guardKey }) => {
      if (!document.getElementById(styleId)) {
        const style = document.createElement("style");
        style.id = styleId;
        style.textContent = `[${hideAttr}="1"]{visibility:hidden !important;opacity:0 !important;pointer-events:none !important;}`;
        document.head.appendChild(style);
      }

      const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1;
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 1;
      const viewportArea = Math.max(viewportWidth * viewportHeight, 1);

      const toNumber = (value: string): number => {
        const parsed = Number.parseFloat(value);
        return Number.isFinite(parsed) ? parsed : 0;
      };

      const hasKeyword = (value: string): boolean =>
        /(modal|popup|newsletter|cookie|consent|gdpr|subscribe|age.?gate|intercom|chat|klaviyo|privy|overlay|drawer|discount)/i.test(
          value,
        );

      const isVisible = (style: CSSStyleDeclaration, rect: DOMRect): boolean => {
        if (style.display === "none" || style.visibility === "hidden") {
          return false;
        }
        if (toNumber(style.opacity) <= 0.01) {
          return false;
        }
        if (rect.width < 2 || rect.height < 2) {
          return false;
        }
        if (rect.bottom < 0 || rect.right < 0) {
          return false;
        }
        if (rect.top > viewportHeight || rect.left > viewportWidth) {
          return false;
        }
        return true;
      };

      const shouldHide = (element: HTMLElement, style: CSSStyleDeclaration, rect: DOMRect): boolean => {
        if (element === document.body || element === document.documentElement) {
          return false;
        }

        const position = style.position;
        const fixedLike = position === "fixed" || position === "sticky";
        const z = toNumber(style.zIndex);
        const elevatedZ = z >= 20;
        const areaRatio = (rect.width * rect.height) / viewportArea;

        const role = (element.getAttribute("role") ?? "").toLowerCase();
        const ariaModal = (element.getAttribute("aria-modal") ?? "").toLowerCase() === "true";
        const metaText = [
          element.id,
          element.className,
          element.getAttribute("role"),
          element.getAttribute("aria-label"),
          element.getAttribute("data-testid"),
          element.getAttribute("data-test"),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        const semanticModal =
          (element.tagName.toLowerCase() === "dialog" || role === "dialog" || role === "alertdialog" || ariaModal || hasKeyword(metaText)) &&
          (fixedLike || elevatedZ);

        const fullScreenOverlay =
          fixedLike &&
          elevatedZ &&
          rect.left <= 4 &&
          rect.top <= 4 &&
          rect.right >= viewportWidth - 4 &&
          rect.bottom >= viewportHeight - 4;

        const centeredOverlay =
          fixedLike &&
          elevatedZ &&
          areaRatio >= 0.12 &&
          areaRatio <= 0.9 &&
          rect.top <= viewportHeight * 0.85 &&
          rect.bottom >= viewportHeight * 0.15 &&
          rect.left <= viewportWidth * 0.9 &&
          rect.right >= viewportWidth * 0.1;

        const bottomOverlay =
          fixedLike &&
          elevatedZ &&
          rect.bottom >= viewportHeight - 2 &&
          rect.height <= viewportHeight * 0.45 &&
          rect.width >= 100;

        const cornerWidget =
          fixedLike &&
          elevatedZ &&
          rect.bottom >= viewportHeight - 2 &&
          (rect.right >= viewportWidth - 2 || rect.left <= 2) &&
          rect.width <= 180 &&
          rect.height <= 180;

        const blockingLayer = fixedLike && elevatedZ && areaRatio >= 0.85;
        return semanticModal || fullScreenOverlay || centeredOverlay || bottomOverlay || cornerWidget || blockingLayer;
      };

      const markHidden = (element: HTMLElement): boolean => {
        if (element.getAttribute(hideAttr) === "1") {
          return false;
        }
        element.setAttribute(hideAttr, "1");
        return true;
      };

      const scanElement = (element: HTMLElement): number => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        if (!isVisible(style, rect)) {
          return 0;
        }
        if (!shouldHide(element, style, rect)) {
          return 0;
        }
        return markHidden(element) ? 1 : 0;
      };

      const scanIframe = (iframe: HTMLIFrameElement): number => {
        const style = window.getComputedStyle(iframe);
        const rect = iframe.getBoundingClientRect();
        if (!isVisible(style, rect)) {
          return 0;
        }
        const position = style.position;
        const fixedLike = position === "fixed" || position === "sticky";
        const z = toNumber(style.zIndex);
        const areaRatio = (rect.width * rect.height) / viewportArea;
        const cornerWidget =
          fixedLike &&
          z >= 20 &&
          rect.bottom >= viewportHeight - 2 &&
          (rect.right >= viewportWidth - 2 || rect.left <= 2) &&
          rect.width <= 180 &&
          rect.height <= 180;
        if (!((fixedLike && z >= 20 && areaRatio >= 0.15) || cornerWidget)) {
          return 0;
        }
        return markHidden(iframe) ? 1 : 0;
      };

      const scanNodeTree = (root: Node): number => {
        let hiddenCount = 0;
        if (root instanceof HTMLElement) {
          if (root instanceof HTMLIFrameElement) {
            hiddenCount += scanIframe(root);
          } else {
            hiddenCount += scanElement(root);
          }
        }
        if (root instanceof Element) {
          const descendants = root.querySelectorAll("*");
          for (const node of descendants) {
            if (node instanceof HTMLIFrameElement) {
              hiddenCount += scanIframe(node);
            } else if (node instanceof HTMLElement) {
              hiddenCount += scanElement(node);
            }
          }
        }
        return hiddenCount;
      };

      const closeSelectors = [
        'button[aria-label*="close" i]',
        '[role="button"][aria-label*="close" i]',
        '[aria-label*="dismiss" i]',
        '[data-testid*="close" i]',
        '[data-test*="close" i]',
        "button.close",
        ".modal-close",
      ];

      for (const candidate of Array.from(document.querySelectorAll(closeSelectors.join(",")))) {
        if (!(candidate instanceof HTMLElement)) {
          continue;
        }
        const style = window.getComputedStyle(candidate);
        const rect = candidate.getBoundingClientRect();
        if (!isVisible(style, rect)) {
          continue;
        }
        const label = `${candidate.getAttribute("aria-label") ?? ""} ${candidate.textContent ?? ""} ${candidate.className ?? ""}`.toLowerCase();
        const looksLikeClose =
          /close|dismiss|not now|no thanks|skip|×|✕|✖/.test(label) ||
          ((candidate.textContent ?? "").trim() === "x" && rect.width <= 60 && rect.height <= 60);
        if (!looksLikeClose) {
          continue;
        }
        candidate.click();
      }

      // Clear common scroll locks set by overlays.
      document.documentElement.style.removeProperty("overflow");
      document.body.style.removeProperty("overflow");
      for (const className of ["modal-open", "overflow-hidden", "no-scroll", "is-locked"]) {
        document.documentElement.classList.remove(className);
        document.body.classList.remove(className);
      }

      scanNodeTree(document.body ?? document.documentElement);

      const globalWithGuard = window as typeof window & Record<string, { observer: MutationObserver } | undefined>;

      if (!globalWithGuard[guardKey]) {
        const observer = new MutationObserver((mutations) => {
          for (const mutation of mutations) {
            if (mutation.type === "attributes" && mutation.target instanceof HTMLElement) {
              scanNodeTree(mutation.target);
              continue;
            }
            for (const addedNode of Array.from(mutation.addedNodes)) {
              scanNodeTree(addedNode);
            }
          }
        });

        observer.observe(document.documentElement, {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: ["class", "style", "role", "aria-modal", "open"],
        });

        globalWithGuard[guardKey] = { observer };
      }

      // Try Escape as a generic "close modal" key.
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      document.dispatchEvent(new KeyboardEvent("keyup", { key: "Escape", bubbles: true }));
      scanNodeTree(document.body ?? document.documentElement);
    },
    {
      hideAttr: STYLEMD_OVERLAY_HIDE_ATTR,
      styleId: STYLEMD_OVERLAY_HIDE_STYLE_ID,
      guardKey: STYLEMD_OVERLAY_GUARD_KEY,
    },
  );

  assertNotAborted(signal);
}

async function suppressStickyChromeForComponentScreenshot(
  page: Page,
  candidateId: string,
  signal: AbortSignal,
): Promise<void> {
  assertNotAborted(signal);

  await page.evaluate(
    ({ candidateId, hideAttr, styleId }) => {
      if (!document.getElementById(styleId)) {
        const style = document.createElement("style");
        style.id = styleId;
        style.textContent = `[${hideAttr}="1"]{visibility:hidden !important;opacity:0 !important;pointer-events:none !important;}`;
        document.head.appendChild(style);
      }

      for (const element of Array.from(document.querySelectorAll(`[${hideAttr}="1"]`))) {
        element.removeAttribute(hideAttr);
      }

      const root = document.querySelector(`[data-stylemd-candidate-id="${candidateId}"]`);
      if (!(root instanceof HTMLElement)) {
        return;
      }

      const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1;
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 1;
      const rootRect = root.getBoundingClientRect();
      const rootTopAbsolute = rootRect.top + window.scrollY;

      const toNumber = (value: string): number => {
        const parsed = Number.parseFloat(value);
        return Number.isFinite(parsed) ? parsed : 0;
      };

      const intersects = (a: DOMRect, b: DOMRect): boolean =>
        !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);

      const maybeChromeText = (element: Element): string =>
        [
          element.tagName,
          element.id,
          element.className,
          element.getAttribute("role"),
          element.getAttribute("aria-label"),
          element.getAttribute("data-testid"),
          element.getAttribute("data-test"),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

      const candidates = Array.from(document.querySelectorAll("*"));
      for (const node of candidates) {
        if (!(node instanceof HTMLElement)) {
          continue;
        }
        if (node === root || node.contains(root) || root.contains(node)) {
          continue;
        }

        const style = window.getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden") {
          continue;
        }
        if (toNumber(style.opacity) <= 0.01) {
          continue;
        }

        const position = style.position;
        if (!(position === "fixed" || position === "sticky")) {
          continue;
        }

        const rect = node.getBoundingClientRect();
        if (rect.width < 24 || rect.height < 12) {
          continue;
        }

        const z = toNumber(style.zIndex);
        const largeBand = rect.width >= viewportWidth * 0.45;
        const limitedHeight = rect.height <= Math.min(viewportHeight * 0.35, 260);
        const anchoredTop = rect.top <= 40;
        const anchoredBottom = rect.bottom >= viewportHeight - 40;
        const elevated = z >= 10;
        const metaText = maybeChromeText(node);
        const navLike = /(header|navbar|nav|menu|toolbar|announcement|topbar|masthead|sticky)/i.test(metaText);

        if (!(largeBand && limitedHeight && (anchoredTop || anchoredBottom) && (elevated || navLike))) {
          continue;
        }

        const overlapsTarget = intersects(rect, rootRect);
        const targetFarFromPageTop = rootTopAbsolute > viewportHeight * 0.75;
        if (!(overlapsTarget || targetFarFromPageTop)) {
          continue;
        }

        node.setAttribute(hideAttr, "1");
      }
    },
    {
      candidateId,
      hideAttr: STYLEMD_CHROME_HIDE_ATTR,
      styleId: STYLEMD_CHROME_HIDE_STYLE_ID,
    },
  );

  assertNotAborted(signal);
}

async function restoreSuppressedStickyChrome(page: Page): Promise<void> {
  await page
    .evaluate(({ hideAttr }) => {
      for (const element of Array.from(document.querySelectorAll(`[${hideAttr}="1"]`))) {
        element.removeAttribute(hideAttr);
      }
    }, {
      hideAttr: STYLEMD_CHROME_HIDE_ATTR,
    })
    .catch(() => undefined);
}

function buildComponentId(candidate: StyleMdCandidate, index: number): string {
  const hash = createHash("sha1")
    .update(`${candidate.selector}|${candidate.rect.top}|${candidate.rect.height}|${index}`)
    .digest("hex")
    .slice(0, 8);
  return `${String(index + 1).padStart(4, "0")}_${hash}`;
}

function safeCssName(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64) || "stylesheet";
}

function shouldCompareDimensions(a: StyleMdComponentEntry, b: StyleMdComponentEntry): boolean {
  const widthDelta = Math.abs(a.rect.width - b.rect.width);
  const heightDelta = Math.abs(a.rect.height - b.rect.height);
  return widthDelta <= 2 && heightDelta <= 2;
}

async function readImageData(path: string, width?: number, height?: number): Promise<RawImageData> {
  const input = width && height
    ? sharp(path).resize(width, height, { fit: "fill" }).ensureAlpha().raw()
    : sharp(path).ensureAlpha().raw();

  const { data, info } = await input.toBuffer({ resolveWithObject: true });
  return {
    width: info.width,
    height: info.height,
    data: new Uint8ClampedArray(data),
  };
}

async function compareImagesWithSsim(pathA: string, pathB: string): Promise<number> {
  let a = await readImageData(pathA);
  let b = await readImageData(pathB);

  if (a.width !== b.width || a.height !== b.height) {
    const width = Math.min(a.width, b.width);
    const height = Math.min(a.height, b.height);
    if (width < 7 || height < 7) {
      return 0;
    }

    a = await readImageData(pathA, width, height);
    b = await readImageData(pathB, width, height);
  }

  if (a.width < 7 || a.height < 7 || b.width < 7 || b.height < 7) {
    return 0;
  }

  const { mssim } = ssim(
    {
      data: a.data,
      width: a.width,
      height: a.height,
    },
    {
      data: b.data,
      width: b.width,
      height: b.height,
    },
    {
      ssim: "weber",
      maxSize: 512,
      downsample: "fast",
    },
  );

  return mssim;
}

async function downsampleScreenshot(buffer: Buffer): Promise<Buffer> {
  const image = sharp(buffer);
  const metadata = await image.metadata();
  const sourceWidth = metadata.width ?? 0;
  const sourceHeight = metadata.height ?? 0;

  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return buffer;
  }

  const targetWidth = Math.max(
    1,
    Math.min(STYLEMD_SCREENSHOT_MAX_WIDTH, Math.round(sourceWidth * STYLEMD_SCREENSHOT_DOWNSAMPLE_RATIO)),
  );
  const targetHeight = Math.max(
    1,
    Math.min(STYLEMD_SCREENSHOT_MAX_HEIGHT, Math.round(sourceHeight * STYLEMD_SCREENSHOT_DOWNSAMPLE_RATIO)),
  );

  return image
    .resize({
      width: targetWidth,
      height: targetHeight,
      fit: "inside",
      withoutEnlargement: true,
      kernel: sharp.kernel.lanczos3,
    })
    .png({
      compressionLevel: 9,
    })
    .toBuffer();
}

export async function runCaptureStage(input: {
  runId: string;
  page: Page;
  signal: AbortSignal;
}): Promise<StageOutput<StyleMdCaptureResult>> {
  const { runId, page, signal } = input;

  await waitForSettledPage(page, signal);
  assertNotAborted(signal);
  await runOverlayHygiene(page, signal);
  assertNotAborted(signal);

  const viewport = page.viewportSize() ?? { width: 1366, height: 900 };

  const documentHeight = await page.evaluate(() => {
    return Math.max(
      document.body?.scrollHeight ?? 0,
      document.documentElement?.scrollHeight ?? 0,
      document.body?.offsetHeight ?? 0,
      document.documentElement?.offsetHeight ?? 0,
    );
  });

  const screenshot = await page.screenshot({
    fullPage: true,
    type: "png",
    animations: "disabled",
  });

  const downsampledScreenshot = await downsampleScreenshot(screenshot);
  const screenshotArtifact = await writeStyleMdImage(runId, "full_screenshot.png", downsampledScreenshot);

  return {
    result: {
      fullScreenshotPath: screenshotArtifact.path,
      viewport: {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: 1,
      },
      documentHeight,
    },
    artifacts: [screenshotArtifact],
  };
}

const FONT_FORMAT_TO_EXTENSION: Record<string, string> = {
  woff2: "woff2",
  woff: "woff",
  truetype: "ttf",
  ttf: "ttf",
  opentype: "otf",
  otf: "otf",
  "embedded-opentype": "eot",
  eot: "eot",
  svg: "svg",
};

function stripCssQuotes(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function safeFontSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64) || "font";
}

function parseFontFaceDeclarations(input: {
  cssText: string;
  sourceHref: string;
  sourceId: string;
}): Array<{
  sourceId: string;
  family: string;
  weight: string;
  style: string;
  source: string;
  resolvedSource: string;
  format?: string;
}> {
  const { cssText, sourceHref, sourceId } = input;
  const faces: Array<{
    sourceId: string;
    family: string;
    weight: string;
    style: string;
    source: string;
    resolvedSource: string;
    format?: string;
  }> = [];

  const blockRegex = /@font-face\s*{([\s\S]*?)}/gi;
  for (const blockMatch of cssText.matchAll(blockRegex)) {
    const block = blockMatch[1] ?? "";
    const familyMatch = block.match(/font-family\s*:\s*([^;]+);/i);
    const srcMatch = block.match(/src\s*:\s*([^;]+);/i);
    if (!familyMatch || !srcMatch) {
      continue;
    }

    const family = stripCssQuotes(familyMatch[1] ?? "");
    if (!family) {
      continue;
    }
    const weight = stripCssQuotes(block.match(/font-weight\s*:\s*([^;]+);/i)?.[1] ?? "400");
    const style = stripCssQuotes(block.match(/font-style\s*:\s*([^;]+);/i)?.[1] ?? "normal");
    const srcValue = srcMatch[1] ?? "";

    const srcRegex = /url\(([^)]+)\)\s*(?:format\(([^)]+)\))?/gi;
    for (const srcEntry of srcValue.matchAll(srcRegex)) {
      const source = stripCssQuotes(srcEntry[1] ?? "");
      if (!source) {
        continue;
      }

      let resolvedSource = source;
      if (!source.toLowerCase().startsWith("data:")) {
        try {
          resolvedSource = new URL(source, sourceHref).toString();
        } catch {
          resolvedSource = source;
        }
      }

      faces.push({
        sourceId,
        family,
        weight: weight || "400",
        style: style || "normal",
        source,
        resolvedSource,
        format: srcEntry[2] ? stripCssQuotes(srcEntry[2]) : undefined,
      });
    }
  }

  return faces;
}

function decodeDataUrlToBuffer(dataUrl: string): {
  mimeType: string;
  buffer: Buffer;
} {
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex === -1) {
    throw new Error("Invalid data URL (missing comma).");
  }

  const meta = dataUrl.slice(5, commaIndex);
  const dataPart = dataUrl.slice(commaIndex + 1);
  const mimeType = (meta.split(";")[0] || "application/octet-stream").trim() || "application/octet-stream";
  const isBase64 = /;base64/i.test(meta);

  const buffer = isBase64
    ? Buffer.from(dataPart, "base64")
    : Buffer.from(decodeURIComponent(dataPart), "utf8");

  if (buffer.length === 0) {
    throw new Error("Decoded data URL produced empty payload.");
  }

  return {
    mimeType,
    buffer,
  };
}

function inferFontExtension(input: {
  resolvedSource: string;
  mimeType?: string;
  format?: string;
}): string {
  const normalizedFormat = (input.format ?? "").toLowerCase().trim();
  if (normalizedFormat && FONT_FORMAT_TO_EXTENSION[normalizedFormat]) {
    return FONT_FORMAT_TO_EXTENSION[normalizedFormat];
  }

  const mime = (input.mimeType ?? "").toLowerCase();
  if (mime.includes("woff2")) return "woff2";
  if (mime.includes("woff")) return "woff";
  if (mime.includes("truetype") || mime.includes("ttf")) return "ttf";
  if (mime.includes("opentype") || mime.includes("otf")) return "otf";
  if (mime.includes("eot") || mime.includes("ms-fontobject")) return "eot";
  if (mime.includes("svg")) return "svg";

  if (!input.resolvedSource.toLowerCase().startsWith("data:")) {
    try {
      const extension = extname(new URL(input.resolvedSource).pathname).toLowerCase().replace(".", "");
      if (extension && /^[a-z0-9]{2,8}$/.test(extension)) {
        return extension;
      }
    } catch {
      // Ignore URL parse failures and fall through.
    }
  }

  return "bin";
}

function buildLocalFontCss(entries: StyleMdFontManifestEntry[], runId: string): string {
  type Group = {
    family: string;
    weight: string;
    style: string;
    sources: Array<{
      path: string;
      format?: string;
    }>;
  };

  const groups = new Map<string, Group>();
  const localized = entries
    .filter((entry) => entry.status === "localized" && entry.localArtifactPath)
    .sort((a, b) => a.id.localeCompare(b.id));

  for (const entry of localized) {
    const localPath = entry.localArtifactPath;
    if (!localPath) {
      continue;
    }
    const cssRelativePath = relative(
      "page_styles",
      toRunRelative(runId, localPath).replace(/\\/g, "/"),
    ).replace(/\\/g, "/");
    const key = `${entry.family}::${entry.weight}::${entry.style}`;
    const existing = groups.get(key) ?? {
      family: entry.family,
      weight: entry.weight,
      style: entry.style,
      sources: [],
    };
    existing.sources.push({
      path: cssRelativePath,
      format: entry.format,
    });
    groups.set(key, existing);
  }

  const orderedGroups = [...groups.values()].sort((a, b) => {
    const familyCmp = a.family.localeCompare(b.family);
    if (familyCmp !== 0) return familyCmp;
    const weightCmp = a.weight.localeCompare(b.weight);
    if (weightCmp !== 0) return weightCmp;
    return a.style.localeCompare(b.style);
  });

  const lines: string[] = [];
  for (const group of orderedGroups) {
    const uniqueSources = new Map<string, { path: string; format?: string }>();
    for (const source of group.sources) {
      if (!uniqueSources.has(source.path)) {
        uniqueSources.set(source.path, source);
      }
    }
    if (uniqueSources.size === 0) {
      continue;
    }

    const srcValue = [...uniqueSources.values()]
      .map((source) => {
        if (source.format) {
          return `url("${source.path}") format("${source.format}")`;
        }
        return `url("${source.path}")`;
      })
      .join(", ");

    lines.push("@font-face {");
    lines.push(`  font-family: "${group.family}";`);
    lines.push(`  font-style: ${group.style};`);
    lines.push(`  font-weight: ${group.weight};`);
    lines.push(`  src: ${srcValue};`);
    lines.push("  font-display: swap;");
    lines.push("}");
    lines.push("");
  }

  return lines.join("\n").trimEnd() + "\n";
}

async function localizeFontAssets(input: {
  runId: string;
  page: Page;
  signal: AbortSignal;
  cssSources: Array<{
    sourceId: string;
    sourceHref: string;
    cssText: string;
  }>;
}): Promise<{
  manifest: StyleMdFontManifest;
  manifestArtifact: StyleMdArtifactRecord;
  localCssArtifact: StyleMdArtifactRecord;
  artifacts: StyleMdArtifactRecord[];
}> {
  const { runId, page, signal, cssSources } = input;
  const artifacts: StyleMdArtifactRecord[] = [];

  const parsedFaces = cssSources.flatMap((source) =>
    parseFontFaceDeclarations({
      cssText: source.cssText,
      sourceHref: source.sourceHref,
      sourceId: source.sourceId,
    }));

  const hashToArtifactPath = new Map<string, string>();
  const sourceCache = new Map<string, {
    ok: boolean;
    buffer?: Buffer;
    mimeType?: string;
    error?: string;
  }>();

  const entries: StyleMdFontManifestEntry[] = [];
  let counter = 0;

  for (const face of parsedFaces) {
    assertNotAborted(signal);
    counter += 1;
    const entryId = `font_${counter.toString().padStart(4, "0")}`;

    try {
      let cached = sourceCache.get(face.resolvedSource);
      if (!cached) {
        if (face.resolvedSource.toLowerCase().startsWith("data:")) {
          const decoded = decodeDataUrlToBuffer(face.resolvedSource);
          cached = {
            ok: true,
            buffer: decoded.buffer,
            mimeType: decoded.mimeType,
          };
        } else {
          try {
            const response = await page.request.get(face.resolvedSource, {
              timeout: 20_000,
            });
            if (!response.ok()) {
              cached = {
                ok: false,
                error: `HTTP ${response.status()}`,
              };
            } else {
              const headers = response.headers();
              cached = {
                ok: true,
                buffer: Buffer.from(await response.body()),
                mimeType: headers["content-type"]?.split(";")[0]?.trim(),
              };
            }
          } catch (error) {
            cached = {
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            };
          }
        }
        sourceCache.set(face.resolvedSource, cached);
      }

      if (!cached.ok || !cached.buffer || cached.buffer.length === 0) {
        entries.push({
          id: entryId,
          family: face.family,
          weight: face.weight,
          style: face.style,
          originalSource: face.source,
          resolvedSource: face.resolvedSource,
          status: "failed",
          format: face.format,
          error: cached.error ?? "Failed to localize font source.",
        });
        continue;
      }

      const hash = createHash("sha256").update(cached.buffer).digest("hex");
      let artifactPath = hashToArtifactPath.get(hash);
      if (!artifactPath) {
        const extension = inferFontExtension({
          resolvedSource: face.resolvedSource,
          mimeType: cached.mimeType,
          format: face.format,
        });
        const fileName = `${safeFontSlug(face.family)}_${hash.slice(0, 16)}.${extension}`;
        const artifact = await writeStyleMdBinary(runId, join("page_styles", "fonts", fileName), cached.buffer);
        artifacts.push(artifact);
        artifactPath = artifact.path;
        hashToArtifactPath.set(hash, artifactPath);
      }

      entries.push({
        id: entryId,
        family: face.family,
        weight: face.weight,
        style: face.style,
        originalSource: face.source,
        resolvedSource: face.resolvedSource,
        localArtifactPath: artifactPath,
        mimeType: cached.mimeType,
        format: face.format,
        hash,
        status: "localized",
      });
    } catch (error) {
      entries.push({
        id: entryId,
        family: face.family,
        weight: face.weight,
        style: face.style,
        originalSource: face.source,
        resolvedSource: face.resolvedSource,
        status: "failed",
        format: face.format,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const localCss = buildLocalFontCss(entries, runId);
  const localCssArtifact = await writeStyleMdText(runId, join("page_styles", "fonts.local.css"), localCss, "css");
  artifacts.push(localCssArtifact);

  const families = new Map<string, number>();
  for (const entry of entries) {
    if (entry.status !== "localized") {
      continue;
    }
    const key = entry.family.trim();
    families.set(key, (families.get(key) ?? 0) + 1);
  }

  const manifest: StyleMdFontManifest = {
    run_id: runId,
    generated_at: new Date().toISOString(),
    entries,
    local_css_path: localCssArtifact.path,
    families: [...families.entries()]
      .map(([family, localized_sources]) => ({
        family,
        localized_sources,
      }))
      .sort((a, b) => {
        if (b.localized_sources !== a.localized_sources) {
          return b.localized_sources - a.localized_sources;
        }
        return a.family.localeCompare(b.family);
      }),
  };

  const manifestArtifact = await writeStyleMdJson(runId, join("page_styles", "fonts.manifest.json"), manifest);
  artifacts.push(manifestArtifact);

  return {
    manifest,
    manifestArtifact,
    localCssArtifact,
    artifacts,
  };
}

async function collectPageStyles(input: {
  runId: string;
  page: Page;
  signal: AbortSignal;
}): Promise<StageOutput<StyleMdStylesheetBundle>> {
  const { runId, page, signal } = input;

  assertNotAborted(signal);

  const stylesMeta = await page.evaluate(() => {
    const inlineStyles = Array.from(document.querySelectorAll("style")).map((node, index) => ({
      id: `inline_${index + 1}`,
      text: node.textContent ?? "",
    }));

    const linkedStyles = Array.from(document.querySelectorAll('link[rel~="stylesheet"]')).map((node, index) => {
      const href = node.getAttribute("href") ?? "";
      const absoluteHref = (node as HTMLLinkElement).href || href;
      return {
        id: `linked_${index + 1}`,
        href: absoluteHref,
      };
    });

    const stylesheetInventory = Array.from(document.styleSheets).map((sheet, index) => {
      let readableRuleCount: number | null = null;

      try {
        readableRuleCount = sheet.cssRules?.length ?? null;
      } catch {
        readableRuleCount = null;
      }

      const mediaText = sheet.media?.mediaText ?? "all";
      const ownerNodeName = (sheet.ownerNode as Element | null)?.nodeName ?? null;

      return {
        id: `sheet_${index + 1}`,
        href: sheet.href,
        media: mediaText,
        disabled: Boolean(sheet.disabled),
        title: sheet.title ?? null,
        ownerNodeName,
        readableRuleCount,
      };
    });

    return {
      inlineStyles,
      linkedStyles,
      stylesheetInventory,
    };
  });

  const artifacts: StyleMdArtifactRecord[] = [];
  const cssSources: Array<{
    sourceId: string;
    sourceHref: string;
    cssText: string;
  }> = [];
  const pageUrl = page.url();

  const inlineStyles: StyleMdStylesheetBundle["inlineStyles"] = [];
  for (const inline of stylesMeta.inlineStyles) {
    assertNotAborted(signal);

    const artifact = await writeStyleMdText(
      runId,
      join("page_styles", `${inline.id}.css`),
      inline.text,
      "css",
    );
    artifacts.push(artifact);
    inlineStyles.push({
      id: inline.id,
      artifactPath: artifact.path,
    });
    cssSources.push({
      sourceId: inline.id,
      sourceHref: pageUrl,
      cssText: inline.text,
    });
  }

  const linkedStyles: StyleMdStylesheetBundle["linkedStyles"] = [];
  for (const linked of stylesMeta.linkedStyles) {
    assertNotAborted(signal);

    if (!linked.href) {
      linkedStyles.push({
        id: linked.id,
        href: linked.href,
        status: "failed",
        error: "Missing href",
      });
      continue;
    }

    try {
      const response = await page.request.get(linked.href, {
        timeout: 20_000,
      });

      if (!response.ok()) {
        linkedStyles.push({
          id: linked.id,
          href: linked.href,
          status: "failed",
          statusCode: response.status(),
          error: `HTTP ${response.status()}`,
        });
        continue;
      }

      const text = await response.text();
      const fileName = `${linked.id}_${safeCssName(basename(new URL(linked.href).pathname))}.css`;
      const artifact = await writeStyleMdText(runId, join("page_styles", fileName), text, "css");
      artifacts.push(artifact);

      linkedStyles.push({
        id: linked.id,
        href: linked.href,
        status: "fetched",
        statusCode: response.status(),
        artifactPath: artifact.path,
      });
      cssSources.push({
        sourceId: linked.id,
        sourceHref: linked.href,
        cssText: text,
      });
    } catch (error) {
      linkedStyles.push({
        id: linked.id,
        href: linked.href,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const localizedFonts = await localizeFontAssets({
    runId,
    page,
    signal,
    cssSources,
  });
  artifacts.push(...localizedFonts.artifacts);

  const bundle: StyleMdStylesheetBundle = {
    inlineStyles,
    linkedStyles,
    stylesheetInventory: stylesMeta.stylesheetInventory,
    fontsManifestPath: localizedFonts.manifestArtifact.path,
    fontsLocalCssPath: localizedFonts.localCssArtifact.path,
  };

  const indexArtifact = await writeStyleMdJson(runId, join("page_styles", "index.json"), bundle);
  artifacts.push(indexArtifact);

  return {
    result: bundle,
    artifacts,
  };
}

async function discoverCandidates(input: {
  page: Page;
  widthThreshold: number;
  minHeightPx: number;
  signal: AbortSignal;
}): Promise<StyleMdCandidate[]> {
  const { page, widthThreshold, minHeightPx, signal } = input;
  assertNotAborted(signal);

  const candidates = await page.evaluate(
    ({ tags, widthThresholdPct, minHeight }) => {
      function cssEscape(value: string): string {
        if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
          return CSS.escape(value);
        }
        return value.replace(/[^a-zA-Z0-9_\-]/g, "\\$&");
      }

      function buildSelector(el: Element): string {
        if (el.id) {
          return `#${cssEscape(el.id)}`;
        }

        const parts: string[] = [];
        let current: Element | null = el;
        let depth = 0;

        while (current && current !== document.body && depth < 5) {
          const tag = current.tagName.toLowerCase();
          const classNames = Array.from(current.classList).slice(0, 3).map((className) => cssEscape(className));
          const classHint = classNames.length > 0 ? `.${classNames.join(".")}` : "";

          let part = `${tag}${classHint}`;
          const parent = current.parentElement;

          if (parent) {
            const siblings = Array.from(parent.children).filter((sibling) => sibling.tagName === current!.tagName);
            if (siblings.length > 1) {
              const nth = siblings.indexOf(current) + 1;
              part += `:nth-of-type(${nth})`;
            }
          }

          parts.unshift(part);
          current = current.parentElement;
          depth += 1;
        }

        return parts.join(" > ");
      }

      const all = Array.from(document.querySelectorAll(tags.join(",")));
      const viewportWidth = window.innerWidth;
      const minWidth = viewportWidth * widthThresholdPct;
      const found: Array<{
        candidateId: string;
        selector: string;
        tagName: string;
        rect: {
          top: number;
          left: number;
          width: number;
          height: number;
          bottom: number;
        };
        childrenCount: number;
        textLength: number;
      }> = [];

      let counter = 0;
      for (const element of all) {
        const style = window.getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
          continue;
        }

        const rect = element.getBoundingClientRect();
        if (rect.height < minHeight || rect.width < minWidth) {
          continue;
        }

        const absoluteTop = rect.top + window.scrollY;
        const absoluteBottom = absoluteTop + rect.height;

        counter += 1;
        const candidateId = `cand_${counter}`;
        element.setAttribute("data-stylemd-candidate-id", candidateId);

        found.push({
          candidateId,
          selector: buildSelector(element),
          tagName: element.tagName.toLowerCase(),
          rect: {
            top: absoluteTop,
            left: rect.left,
            width: rect.width,
            height: rect.height,
            bottom: absoluteBottom,
          },
          childrenCount: element.querySelectorAll("*").length,
          textLength: (element.textContent ?? "").trim().length,
        });
      }

      found.sort((a, b) => {
        if (a.rect.top !== b.rect.top) {
          return a.rect.top - b.rect.top;
        }
        return b.rect.height - a.rect.height;
      });

      return found;
    },
    {
      tags: FULL_WIDTH_TAGS,
      widthThresholdPct: widthThreshold,
      minHeight: minHeightPx,
    },
  );

  return candidates;
}

async function extractComponentPayload(page: Page, candidateId: string): Promise<ComponentExtractPayload> {
  return page.evaluate(
    ({ candidateId, styleTreeProperties, agentStyleProperties, pseudoCriticalProperties }) => {
      function styleObject(style: CSSStyleDeclaration): Record<string, string> {
        const output: Record<string, string> = {};
        for (let i = 0; i < style.length; i += 1) {
          const prop = style[i];
          output[prop] = style.getPropertyValue(prop);
        }
        return output;
      }

      function pickStyles(style: CSSStyleDeclaration, keys: string[]): Record<string, string> {
        const output: Record<string, string> = {};
        for (const key of keys) {
          const value = style.getPropertyValue(key);
          if (value) {
            output[key] = value;
          }
        }
        return output;
      }

      function normalizeColor(value: string): string {
        return value.replace(/\s+/g, "").toLowerCase();
      }

      function hasVisibleBackground(style: CSSStyleDeclaration): boolean {
        const value = style.getPropertyValue("background-color");
        if (!value) {
          return false;
        }
        const normalized = normalizeColor(value);
        return normalized !== "transparent" && normalized !== "rgba(0,0,0,0)";
      }

      function hasBorder(style: CSSStyleDeclaration): boolean {
        const borderTop = Number.parseFloat(style.getPropertyValue("border-top-width") || "0");
        const borderRight = Number.parseFloat(style.getPropertyValue("border-right-width") || "0");
        const borderBottom = Number.parseFloat(style.getPropertyValue("border-bottom-width") || "0");
        const borderLeft = Number.parseFloat(style.getPropertyValue("border-left-width") || "0");
        return borderTop > 0 || borderRight > 0 || borderBottom > 0 || borderLeft > 0;
      }

      function isSignificantNode(
        element: Element,
        style: CSSStyleDeclaration,
        textSample: string,
        isRoot: boolean,
      ): boolean {
        if (isRoot) {
          return true;
        }
        const tag = element.tagName.toLowerCase();
        if (
          tag === "a" ||
          tag === "button" ||
          tag === "input" ||
          tag === "select" ||
          tag === "textarea" ||
          tag === "label" ||
          tag === "img" ||
          tag === "picture" ||
          tag === "svg" ||
          tag === "video" ||
          tag === "canvas" ||
          /^h[1-6]$/.test(tag)
        ) {
          return true;
        }
        if (textSample.length > 0) {
          return true;
        }
        const display = style.getPropertyValue("display");
        if (display.includes("flex") || display.includes("grid")) {
          return true;
        }
        const position = style.getPropertyValue("position");
        if (position && position !== "static") {
          return true;
        }
        if (hasVisibleBackground(style) || hasBorder(style)) {
          return true;
        }
        return false;
      }

      function sanitizeDomForAgent(root: Element): string {
        const clone = root.cloneNode(true) as Element;
        for (const removable of Array.from(clone.querySelectorAll("script,style,noscript,iframe"))) {
          removable.remove();
        }
        for (const element of [clone, ...Array.from(clone.querySelectorAll("*"))]) {
          for (const attr of Array.from(element.attributes)) {
            if (attr.name.toLowerCase().startsWith("data-stylemd-")) {
              element.removeAttribute(attr.name);
              continue;
            }
            if (attr.name.toLowerCase().startsWith("on")) {
              element.removeAttribute(attr.name);
            }
          }
        }
        return clone.outerHTML;
      }

      function buildPseudoAgentStyles(
        rootStyle: CSSStyleDeclaration,
        pseudoStyle: CSSStyleDeclaration,
      ): Record<string, string> {
        const output: Record<string, string> = {};
        for (const key of pseudoCriticalProperties) {
          const pseudoValue = pseudoStyle.getPropertyValue(key);
          if (!pseudoValue) {
            continue;
          }
          if (key === "content") {
            const normalized = pseudoValue.trim();
            if (
              normalized &&
              normalized !== "none" &&
              normalized !== "normal" &&
              normalized !== "\"\"" &&
              normalized !== "''"
            ) {
              output[key] = pseudoValue;
            }
            continue;
          }
          const rootValue = rootStyle.getPropertyValue(key);
          if (pseudoValue !== rootValue) {
            output[key] = pseudoValue;
          }
        }
        return output;
      }

      function nodePath(node: Element): string {
        const path: string[] = [];
        let current: Element | null = node;

        while (current && current !== document.body) {
          const nodeAtDepth: Element = current;
          let part = nodeAtDepth.tagName.toLowerCase();
          if (nodeAtDepth.id) {
            part += `#${nodeAtDepth.id}`;
          } else {
            const siblings = nodeAtDepth.parentElement
              ? Array.from(nodeAtDepth.parentElement.children).filter(
                  (sibling: Element) => sibling.tagName === nodeAtDepth.tagName,
                )
              : [];
            if (siblings.length > 1) {
              const nth = siblings.indexOf(nodeAtDepth) + 1;
              part += `:nth-of-type(${nth})`;
            }
          }
          path.unshift(part);
          current = nodeAtDepth.parentElement;
        }

        return path.join(" > ");
      }

      function collectCssRuleRefs(root: Element): Array<{
        stylesheetIndex: number;
        stylesheetHref: string | null;
        selectorText: string;
        cssText: string;
      }> {
        const refs: Array<{
          stylesheetIndex: number;
          stylesheetHref: string | null;
          selectorText: string;
          cssText: string;
        }> = [];

        function inspectRule(
          rule: CSSRule,
          stylesheetIndex: number,
          stylesheetHref: string | null,
        ): void {
          if (rule instanceof CSSStyleRule) {
            try {
              if (root.matches(rule.selectorText)) {
                refs.push({
                  stylesheetIndex,
                  stylesheetHref,
                  selectorText: rule.selectorText,
                  cssText: rule.cssText,
                });
              }
            } catch {
              // Ignore invalid selectors.
            }
            return;
          }

          if (rule instanceof CSSMediaRule || rule instanceof CSSSupportsRule) {
            for (const nestedRule of Array.from(rule.cssRules)) {
              inspectRule(nestedRule, stylesheetIndex, stylesheetHref);
            }
          }
        }

        for (let i = 0; i < document.styleSheets.length; i += 1) {
          const stylesheet = document.styleSheets[i];

          try {
            for (const rule of Array.from(stylesheet.cssRules ?? [])) {
              inspectRule(rule, i, stylesheet.href ?? null);
            }
          } catch {
            // Skip stylesheets that are not readable due to cross-origin restrictions.
          }
        }

        return refs;
      }

      const root = document.querySelector(`[data-stylemd-candidate-id="${candidateId}"]`);
      if (!root) {
        return {
          found: false,
          reason: "candidate not found",
        };
      }

      const rect = root.getBoundingClientRect();
      const absoluteTop = rect.top + window.scrollY;
      const absoluteBottom = absoluteTop + rect.height;

      const computedStyles = styleObject(window.getComputedStyle(root));
      const rootStyle = window.getComputedStyle(root);
      const pseudoStyles = {
        before: styleObject(window.getComputedStyle(root, "::before")),
        after: styleObject(window.getComputedStyle(root, "::after")),
      };
      const agentStyles = pickStyles(rootStyle, agentStyleProperties);
      const agentPseudoStyles = {
        before: buildPseudoAgentStyles(rootStyle, window.getComputedStyle(root, "::before")),
        after: buildPseudoAgentStyles(rootStyle, window.getComputedStyle(root, "::after")),
      };
      const agentDomHtml = sanitizeDomForAgent(root);

      const styleTree: Array<{
        nodePath: string;
        tagName: string;
        id: string | null;
        className: string;
        textSample: string;
        rect: {
          top: number;
          left: number;
          width: number;
          height: number;
          bottom: number;
        };
        styles: Record<string, string>;
      }> = [];
      const agentStyleTree: Array<{
        nodePath: string;
        tagName: string;
        id: string | null;
        className: string;
        textSample: string;
        rect: {
          top: number;
          left: number;
          width: number;
          height: number;
          bottom: number;
        };
        styles: Record<string, string>;
      }> = [];

      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      let current: Node | null = walker.currentNode;
      while (current) {
        const element = current as Element;
        const elementRect = element.getBoundingClientRect();
        const elementTop = elementRect.top + window.scrollY;
        const elementStyle = window.getComputedStyle(element);
        const textSample = (element.textContent ?? "").trim().slice(0, 180);
        const nodeRect = {
          top: elementTop,
          left: elementRect.left,
          width: elementRect.width,
          height: elementRect.height,
          bottom: elementTop + elementRect.height,
        };
        const nodePathValue = nodePath(element);
        const isRoot = element === root;
        const elementTag = element.tagName.toLowerCase();
        const className = element.className || "";
        const idValue = element.id || null;

        styleTree.push({
          nodePath: nodePathValue,
          tagName: elementTag,
          id: idValue,
          className,
          textSample,
          rect: nodeRect,
          styles: pickStyles(elementStyle, styleTreeProperties),
        });

        if (isSignificantNode(element, elementStyle, textSample, isRoot)) {
          agentStyleTree.push({
            nodePath: nodePathValue,
            tagName: elementTag,
            id: idValue,
            className,
            textSample,
            rect: nodeRect,
            styles: pickStyles(elementStyle, agentStyleProperties),
          });
        }

        current = walker.nextNode();
      }

      const uniqueAgentStyleTree: typeof agentStyleTree = [];
      const seenNodePaths = new Set<string>();
      for (const entry of agentStyleTree) {
        if (seenNodePaths.has(entry.nodePath)) {
          continue;
        }
        seenNodePaths.add(entry.nodePath);
        uniqueAgentStyleTree.push(entry);
        if (uniqueAgentStyleTree.length >= 80) {
          break;
        }
      }

      const cssRuleRefs = collectCssRuleRefs(root);

      return {
        found: true,
        selector: root instanceof Element ? root.tagName.toLowerCase() : "",
        tagName: root.tagName.toLowerCase(),
        rect: {
          top: absoluteTop,
          left: rect.left,
          width: rect.width,
          height: rect.height,
          bottom: absoluteBottom,
        },
        domHtml: root.outerHTML,
        computedStyles,
        pseudoStyles,
        agentDomHtml,
        agentStyles,
        agentPseudoStyles,
        styleTree,
        agentStyleTree: uniqueAgentStyleTree,
        cssRuleRefs,
        metadata: {
          subtreeElementCount: styleTree.length,
          textLength: (root.textContent ?? "").trim().length,
        },
      };
    },
    {
      candidateId,
      styleTreeProperties: [...STYLE_TREE_PROPERTIES],
      agentStyleProperties: [...AGENT_STYLE_PROPERTIES],
      pseudoCriticalProperties: [...PSEUDO_CRITICAL_PROPERTIES],
    },
  );
}

export async function runExtractStage(input: {
  runId: string;
  page: Page;
  config: StyleMdPipelineConfig;
  signal: AbortSignal;
}): Promise<StageOutput<StyleMdExtractResult>> {
  const { runId, page, config, signal } = input;

  assertNotAborted(signal);
  await runOverlayHygiene(page, signal);
  assertNotAborted(signal);

  const artifacts: StyleMdArtifactRecord[] = [];

  const pageStyles = await collectPageStyles({
    runId,
    page,
    signal,
  });
  artifacts.push(...pageStyles.artifacts);

  const candidates = await discoverCandidates({
    page,
    widthThreshold: config.widthThreshold,
    minHeightPx: config.minHeightPx,
    signal,
  });

  const candidatesArtifact = await writeStyleMdJson(runId, join("components", "candidates.json"), {
    widthThreshold: config.widthThreshold,
    minHeightPx: config.minHeightPx,
    candidateCount: candidates.length,
    candidates,
  });
  artifacts.push(candidatesArtifact);

  // --- PHASE 1: DETERMINISTIC DESIGN TOKEN EXTRACTION ---
  const semanticManifest = await analyzeSemanticDesignSystem(page, runId);
  const semanticArtifact = await writeStyleMdJson(runId, "semantic_analysis.json", semanticManifest);
  artifacts.push(semanticArtifact);

  runIdLog(runId, `[PIPELINE] Semantic analysis complete. Scanned ${semanticManifest.metrics.totalElementsScanned} elements in ${semanticManifest.metrics.extractionDurationMs}ms.`);

  // --- PHASE 4: VISUAL REBALANCING ---
  const fullScreenshotPath = artifacts.find(a => a.name === "full_screenshot.png")?.path;
  if (fullScreenshotPath) {
    try {
      const visualPalette = await analyzeScreenshotDominantColors(fullScreenshotPath);
      rebalancePaletteWithVisuals(semanticManifest, visualPalette);
      runIdLog(runId, `[PIPELINE] Visual rebalancing complete. Detected atmospheric colors: ${visualPalette.join(", ")}`);
    } catch (e) {
      runIdLog(runId, `[PIPELINE] Visual rebalancing failed: ${e instanceof Error ? e.message : String(e)}`, "warn");
    }
  }

  runIdLog(runId, `[PIPELINE] Final confidence score: ${semanticManifest.metrics.confidenceScore}. Primary colors: ${semanticManifest.palette.primary.join(", ")}`);

  const semanticStructure = await analyzeSemanticStructure(page, runId, candidates);
  const structureArtifact = await writeStyleMdJson(runId, "semantic_structure.json", semanticStructure);
  artifacts.push(structureArtifact);

  runIdLog(runId, `[PIPELINE] Structural analysis complete. Identified ${semanticStructure.sections.length} semantic sections.`);

  const components: StyleMdComponentEntry[] = [];

  for (let i = 0; i < candidates.length; i += 1) {
    assertNotAborted(signal);

    const candidate = candidates[i];
    const componentId = buildComponentId(candidate, i);
    const componentDir = join("components", componentId);

    const locator = page.locator(`[data-stylemd-candidate-id="${candidate.candidateId}"]`).first();
    const count = await locator.count();
    if (count === 0) {
      continue;
    }

    const payload = await extractComponentPayload(page, candidate.candidateId);
    if (!payload.found) {
      continue;
    }

    await locator.scrollIntoViewIfNeeded({ timeout: 10_000 }).catch(() => undefined);
    await runOverlayHygiene(page, signal);
    await suppressStickyChromeForComponentScreenshot(page, candidate.candidateId, signal);
    assertNotAborted(signal);

    let screenshotBuffer: Buffer;
    try {
      screenshotBuffer = await locator.screenshot({
        type: "png",
        animations: "disabled",
      });
    } catch {
      continue;
    } finally {
      await restoreSuppressedStickyChrome(page);
    }

    const downsampledComponentScreenshot = await downsampleScreenshot(screenshotBuffer);
    const screenshotArtifact = await writeStyleMdImage(
      runId,
      join(componentDir, "screenshot.png"),
      downsampledComponentScreenshot,
    );
    artifacts.push(screenshotArtifact);

    const domArtifact = await writeStyleMdText(
      runId,
      join(componentDir, "dom.html"),
      payload.domHtml ?? "",
      "html",
    );
    const domAgentArtifact = await writeStyleMdText(
      runId,
      join(componentDir, "dom.agent.html"),
      payload.agentDomHtml ?? "",
      "html",
    );
    const stylesArtifact = await writeStyleMdJson(runId, join(componentDir, "styles.json"), payload.computedStyles ?? {});
    const stylesAgentArtifact = await writeStyleMdJson(
      runId,
      join(componentDir, "styles.agent.json"),
      payload.agentStyles ?? {},
    );
    const styleTreeArtifact = await writeStyleMdJson(runId, join(componentDir, "style_tree.json"), payload.styleTree ?? []);
    const styleTreeAgentArtifact = await writeStyleMdJson(
      runId,
      join(componentDir, "style_tree.agent.json"),
      payload.agentStyleTree ?? [],
    );
    const pseudoStylesArtifact = await writeStyleMdJson(
      runId,
      join(componentDir, "pseudo_styles.json"),
      payload.pseudoStyles ?? { before: {}, after: {} },
    );
    const pseudoStylesAgentArtifact = await writeStyleMdJson(
      runId,
      join(componentDir, "pseudo.agent.json"),
      payload.agentPseudoStyles ?? { before: {}, after: {} },
    );
    const cssRuleRefsArtifact = await writeStyleMdJson(
      runId,
      join(componentDir, "css_rule_refs.json"),
      payload.cssRuleRefs ?? [],
    );

    artifacts.push(
      domArtifact,
      domAgentArtifact,
      stylesArtifact,
      stylesAgentArtifact,
      styleTreeArtifact,
      styleTreeAgentArtifact,
      pseudoStylesArtifact,
      pseudoStylesAgentArtifact,
      cssRuleRefsArtifact,
    );

    const metadata = {
      componentId,
      candidateId: candidate.candidateId,
      selector: candidate.selector,
      tagName: candidate.tagName,
      rect: candidate.rect,
      extractedRect: payload.rect ?? candidate.rect,
      childrenCount: candidate.childrenCount,
      textLength: candidate.textLength,
      subtreeElementCount: payload.metadata?.subtreeElementCount ?? 0,
      extractedAt: new Date().toISOString(),
    };

    const metadataArtifact = await writeStyleMdJson(runId, join(componentDir, "metadata.json"), metadata);
    artifacts.push(metadataArtifact);

    components.push({
      componentId,
      candidateId: candidate.candidateId,
      selector: candidate.selector,
      tagName: candidate.tagName,
      rect: payload.rect ?? candidate.rect,
      directory: dirname(screenshotArtifact.path),
      screenshotPath: screenshotArtifact.path,
      metadataPath: metadataArtifact.path,
      domPath: domArtifact.path,
      stylesPath: stylesArtifact.path,
      styleTreePath: styleTreeArtifact.path,
      pseudoStylesPath: pseudoStylesArtifact.path,
      cssRuleRefsPath: cssRuleRefsArtifact.path,
      agentDomPath: domAgentArtifact.path,
      agentStylesPath: stylesAgentArtifact.path,
      agentStyleTreePath: styleTreeAgentArtifact.path,
      agentPseudoStylesPath: pseudoStylesAgentArtifact.path,
    });
  }

  await page.evaluate(() => {
    for (const element of Array.from(document.querySelectorAll("[data-stylemd-candidate-id]"))) {
      element.removeAttribute("data-stylemd-candidate-id");
    }
  }).catch(() => undefined);

  const rawManifestArtifact = await writeStyleMdJson(
    runId,
    join("components", "components_manifest.raw.json"),
    components,
  );
  artifacts.push(rawManifestArtifact);

  const pageStylesIndexPath =
    pageStyles.artifacts.find((artifact) => artifact.name === join("page_styles", "index.json"))?.path ?? "";
  const fontsManifestPath =
    pageStyles.artifacts.find((artifact) => artifact.name === join("page_styles", "fonts.manifest.json"))?.path ?? "";
  const fontsLocalCssPath =
    pageStyles.artifacts.find((artifact) => artifact.name === join("page_styles", "fonts.local.css"))?.path ?? "";

  return {
    result: {
      candidatesPath: candidatesArtifact.path,
      rawManifestPath: rawManifestArtifact.path,
      pageStylesPath: pageStylesIndexPath,
      fontsManifestPath,
      fontsLocalCssPath,
      designTokenManifestPath: semanticArtifact.path,
      designTokenManifest: semanticManifest,
      semanticStructurePath: structureArtifact.path,
      semanticStructure,
      components,
      candidateCount: candidates.length,
    },
    artifacts,
  };
}

export async function runDedupStage(input: {
  runId: string;
  components: StyleMdComponentEntry[];
  threshold: number;
  signal: AbortSignal;
}): Promise<StageOutput<StyleMdDedupResult>> {
  const { runId, components, threshold, signal } = input;

  assertNotAborted(signal);

  const artifacts: StyleMdArtifactRecord[] = [];
  const sorted = [...components].sort((a, b) => {
    if (a.rect.top !== b.rect.top) {
      return a.rect.top - b.rect.top;
    }
    return a.rect.left - b.rect.left;
  });

  const kept: StyleMdComponentEntry[] = [];
  const duplicates: StyleMdDuplicatePair[] = [];
  const deletedComponentIds: string[] = [];

  for (const component of sorted) {
    assertNotAborted(signal);

    let duplicatePair: StyleMdDuplicatePair | null = null;

    for (const canonical of kept) {
      if (!shouldCompareDimensions(component, canonical)) {
        continue;
      }

      const score = await compareImagesWithSsim(component.screenshotPath, canonical.screenshotPath);
      if (score >= threshold) {
        duplicatePair = {
          canonicalComponentId: canonical.componentId,
          duplicateComponentId: component.componentId,
          score,
        };
        break;
      }
    }

    if (duplicatePair) {
      duplicates.push(duplicatePair);
      deletedComponentIds.push(component.componentId);
      continue;
    }

    kept.push(component);
  }

  for (const duplicateId of deletedComponentIds) {
    const duplicate = sorted.find((entry) => entry.componentId === duplicateId);
    if (!duplicate) {
      continue;
    }
    await rm(duplicate.directory, { recursive: true, force: true });
  }

  const deduped = kept.map((component) => {
    const matchedPair = duplicates.find((pair) => pair.duplicateComponentId === component.componentId);
    if (!matchedPair) {
      return component;
    }
    return {
      ...component,
      duplicateOf: matchedPair.canonicalComponentId,
    };
  });

  const dedupManifestArtifact = await writeStyleMdJson(
    runId,
    join("components", "components_manifest.deduped.json"),
    deduped,
  );
  const dedupAgentManifestArtifact = await writeStyleMdJson(
    runId,
    join("components", "components_manifest.agent.json"),
    {
      run_id: runId,
      generated_at: new Date().toISOString(),
      component_count: deduped.length,
      components: deduped.map((component) => ({
        component_id: component.componentId,
        selector: component.selector,
        tag_name: component.tagName,
        rect: component.rect,
        files: {
          screenshot: toRunRelative(runId, component.screenshotPath),
          metadata: toRunRelative(runId, component.metadataPath),
          dom_agent: toRunRelative(runId, component.agentDomPath),
          styles_agent: toRunRelative(runId, component.agentStylesPath),
          pseudo_agent: toRunRelative(runId, component.agentPseudoStylesPath),
          style_tree_agent: toRunRelative(runId, component.agentStyleTreePath),
        },
      })),
    },
  );
  const duplicatesArtifact = await writeStyleMdJson(
    runId,
    join("components", "duplicates.json"),
    {
      threshold,
      duplicatePairs: duplicates,
      deletedComponentIds,
    },
  );

  artifacts.push(dedupManifestArtifact, dedupAgentManifestArtifact, duplicatesArtifact);

  return {
    result: {
      dedupManifestPath: dedupManifestArtifact.path,
      dedupAgentManifestPath: dedupAgentManifestArtifact.path,
      duplicatesPath: duplicatesArtifact.path,
      deletedComponentIds,
      duplicatePairs: duplicates,
      keptComponents: deduped,
    },
    artifacts,
  };
}

const STYLEMD_CURATED_BREAKPOINTS = [
  { name: "desktop" as const, width: 1366, height: 900 },
  { name: "tablet" as const, width: 1024, height: 1366 },
  { name: "mobile" as const, width: 390, height: 844 },
];

function safeArtifactSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export async function runCuratedResponsiveHoverEvidenceStage(input: {
  runId: string;
  url: string;
  page: Page;
  curatedManifest: StyleMdCuratedManifest;
  signal: AbortSignal;
}): Promise<StageOutput<{
  evidencePath: string;
  evidence: StyleMdResponsiveHoverEvidence;
}>> {
  const { runId, url, page, curatedManifest, signal } = input;
  assertNotAborted(signal);

  const artifacts: StyleMdArtifactRecord[] = [];

  const evidence: StyleMdResponsiveHoverEvidence = {
    run_id: runId,
    url,
    generated_at: new Date().toISOString(),
    breakpoints: [],
  };

  for (const breakpoint of STYLEMD_CURATED_BREAKPOINTS) {
    assertNotAborted(signal);
    await page.setViewportSize({
      width: breakpoint.width,
      height: breakpoint.height,
    });
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    await runOverlayHygiene(page, signal);

    const breakpointUnits: StyleMdResponsiveHoverEvidence["breakpoints"][number]["units"] = [];

    for (const unit of curatedManifest.units) {
      assertNotAborted(signal);
      const capturedComponents: {
        component_id: string;
        selector: string;
        found: boolean;
        default_screenshot?: string;
        hover_screenshot?: string;
        hover_method?: "cdp_force_pseudo" | "playwright_hover" | "none";
        error?: string;
      }[] = [];

      for (const component of unit.components) {
        assertNotAborted(signal);
        const locator = page.locator(component.selector).first();
        const count = await locator.count();
        if (count === 0) {
          capturedComponents.push({
            component_id: component.componentId,
            selector: component.selector,
            found: false,
            hover_method: "none",
            error: "selector_not_found",
          });
          continue;
        }

        const relativeBase = join(
          "styleguide",
          "enrichment",
          breakpoint.name,
          safeArtifactSegment(unit.unit_id),
          safeArtifactSegment(component.componentId),
        );
        const defaultRelPath = `${relativeBase}.default.png`;
        const hoverRelPath = `${relativeBase}.hover.png`;

        let hoverMethod: "cdp_force_pseudo" | "playwright_hover" | "none" = "none";
        let captureError: string | undefined;

        try {
          await locator.scrollIntoViewIfNeeded({ timeout: 8_000 });
          await runOverlayHygiene(page, signal);
          const defaultBuffer = await locator.screenshot({
            type: "png",
            animations: "disabled",
          });
          const downsampledDefaultBuffer = await downsampleScreenshot(defaultBuffer);
          const defaultArtifact = await writeStyleMdImage(runId, defaultRelPath, downsampledDefaultBuffer);
          artifacts.push(defaultArtifact);

          let hoverCaptured = false;
          let cdpSession: CDPSession | null = null;
          let cdpNodeId: number | null = null;

          try {
            const session = await page.context().newCDPSession(page);
            cdpSession = session;
            await session.send("DOM.enable");
            await session.send("CSS.enable");
            const docResult = await session.send("DOM.getDocument", { depth: -1, pierce: true }) as {
              root?: { nodeId?: number };
            };
            const rootNodeId = docResult.root?.nodeId;
            if (typeof rootNodeId !== "number") {
              throw new Error("Failed to resolve DOM root node for pseudo-state forcing.");
            }
            const foundResult = await session.send("DOM.querySelector", {
              nodeId: rootNodeId,
              selector: component.selector,
            }) as { nodeId?: number };
            cdpNodeId = typeof foundResult.nodeId === "number" ? foundResult.nodeId : null;
            if (cdpNodeId) {
              await session.send("CSS.forcePseudoState", {
                nodeId: cdpNodeId,
                forcedPseudoClasses: ["hover"],
              });
              await runOverlayHygiene(page, signal);
              const hoverBuffer = await locator.screenshot({
                type: "png",
                animations: "disabled",
              });
              const downsampledHoverBuffer = await downsampleScreenshot(hoverBuffer);
              const hoverArtifact = await writeStyleMdImage(runId, hoverRelPath, downsampledHoverBuffer);
              artifacts.push(hoverArtifact);
              hoverMethod = "cdp_force_pseudo";
              hoverCaptured = true;
            }
          } catch {
            // Fall through to Playwright hover fallback.
          } finally {
            if (cdpSession && cdpNodeId) {
              await cdpSession.send("CSS.forcePseudoState", {
                nodeId: cdpNodeId,
                forcedPseudoClasses: [],
              }).catch(() => undefined);
            }
            if (cdpSession) {
              await cdpSession.detach().catch(() => undefined);
            }
          }

          if (!hoverCaptured) {
            await locator.hover({ force: true, timeout: 5_000 }).catch(() => undefined);
            await runOverlayHygiene(page, signal);
            const hoverBuffer = await locator.screenshot({
              type: "png",
              animations: "disabled",
            });
            const downsampledHoverBuffer = await downsampleScreenshot(hoverBuffer);
            const hoverArtifact = await writeStyleMdImage(runId, hoverRelPath, downsampledHoverBuffer);
            artifacts.push(hoverArtifact);
            hoverMethod = "playwright_hover";
          }

          capturedComponents.push({
            component_id: component.componentId,
            selector: component.selector,
            found: true,
            default_screenshot: defaultRelPath,
            hover_screenshot: hoverRelPath,
            hover_method: hoverMethod,
          });
        } catch (error) {
          captureError = error instanceof Error ? error.message : String(error);
          capturedComponents.push({
            component_id: component.componentId,
            selector: component.selector,
            found: false,
            hover_method: hoverMethod,
            error: captureError,
          });
        }
      }

      breakpointUnits.push({
        unit_id: unit.unit_id,
        components: capturedComponents,
      });
    }

    evidence.breakpoints.push({
      name: breakpoint.name,
      viewport: {
        width: breakpoint.width,
        height: breakpoint.height,
      },
      units: breakpointUnits,
    });
  }

  const evidenceArtifact = await writeStyleMdJson(
    runId,
    join("styleguide", "evidence.responsive_hover.json"),
    evidence,
  );
  artifacts.push(evidenceArtifact);

  return {
    result: {
      evidencePath: evidenceArtifact.path,
      evidence,
    },
    artifacts,
  };
}

/**
 * PHASE 1: Deterministic Design Token Extraction
 * Scans the full document in the browser to build a semantic Design Token Manifest.
 */
async function analyzeSemanticDesignSystem(page: Page, runId: string): Promise<StyleMdDesignTokenManifest> {
  const startTime = Date.now();
  
  const manifest = await page.evaluate(({ runId, url }) => {
    // @ts-ignore
    const __name = (t, v) => t;
    
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 1;
    const viewportArea = viewportWidth * viewportHeight;

    // --- HELPERS ---

    function rgbToHex(rgb: string, parentBg?: string): string {
      if (!rgb || rgb === "transparent" || rgb === "rgba(0, 0, 0, 0)") return "transparent";
      const match = rgb.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/);
      if (!match) return rgb;
      
      let r = parseInt(match[1]);
      let g = parseInt(match[2]);
      let b = parseInt(match[3]);
      const a = match[4] ? parseFloat(match[4]) : 1;

      if (a < 1 && parentBg && parentBg.startsWith("#")) {
        const pr = parseInt(parentBg.slice(1, 3), 16);
        const pg = parseInt(parentBg.slice(3, 5), 16);
        const pb = parseInt(parentBg.slice(5, 7), 16);
        
        r = Math.round(r * a + pr * (1 - a));
        g = Math.round(g * a + pg * (1 - a));
        b = Math.round(b * a + pb * (1 - a));
      }

      const rh = r.toString(16).padStart(2, "0");
      const gh = g.toString(16).padStart(2, "0");
      const bh = b.toString(16).padStart(2, "0");
      return `#${rh}${gh}${bh}`;
    }

    function getEffectiveBackground(el: HTMLElement): string {
      let current: HTMLElement | null = el;
      let blendedHex: string | null = null;
      
      while (current) {
        const style = window.getComputedStyle(current);
        const bg = style.backgroundColor;
        
        if (bg && bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)") {
          const match = bg.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/);
          const a = match?.[4] ? parseFloat(match[4]) : 1;
          
          if (a === 1) return rgbToHex(bg);
          
          if (!blendedHex) {
            blendedHex = rgbToHex(bg);
          } else {
            blendedHex = rgbToHex(bg, blendedHex);
          }
          
          if (a > 0.95) return blendedHex; 
        }
        current = current.parentElement;
      }
      return blendedHex || "#ffffff"; 
    }

    function normalizeUnit(value: string): string {
      if (!value || value === "none" || value === "0px" || value === "auto") return value;
      const match = value.match(/^([\d.]+)(px|rem|em|vh|vw|%)$/);
      if (!match) return value;
      const num = parseFloat(match[1]);
      const unit = match[2];
      
      if (unit === "px") {
        if (num < 1) return "0px";
        if (num > 2 && num < 6) return "4px";
        if (num >= 6 && num < 10) return "8px";
        if (num >= 10 && num < 14) return "12px";
        if (num >= 14 && num < 18) return "16px";
        if (num >= 22 && num < 26) return "24px";
        if (num >= 30 && num < 34) return "32px";
        return `${Math.round(num)}px`;
      }
      return value;
    }

    function isVisible(el: HTMLElement): boolean {
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || parseFloat(style.opacity) <= 0.05) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return false;
      if (rect.bottom < 0 || rect.top > viewportHeight || rect.right < 0 || rect.left > viewportWidth) return false;
      return true;
    }

    // --- DATA COLLECTION ---

    const colorStats = new Map<string, {
      count: number;
      area: number;
      roles: Set<string>;
      elements: Set<string>;
      isHeading: boolean;
      isButton: boolean;
      confidence: "confirmed" | "inferred" | "weak_signal";
    }>();

    const typographyUsage = new Map<string, {
      family: string;
      size: string;
      weight: string;
      lineHeight: string;
      color: string;
      count: number;
      tags: Set<string>;
    }>();

    const spacingSet = new Set<string>();
    const radiiSet = new Set<string>();
    const shadowsSet = new Set<string>();
    const gradientsSet = new Set<string>();
    const surfaces: any[] = [];
    const cssVars: Record<string, string> = {};

    try {
      const sheets = Array.from(document.styleSheets);
      const rootStyle = window.getComputedStyle(document.documentElement);
      for (const sheet of sheets) {
        try {
          const rules = Array.from(sheet.cssRules);
          for (const rule of rules) {
            if (rule instanceof CSSStyleRule && (rule.selectorText.includes(":root") || rule.selectorText.includes("body"))) {
              for (let i = 0; i < rule.style.length; i++) {
                const prop = rule.style[i];
                if (prop.startsWith("--")) {
                  const val = rootStyle.getPropertyValue(prop).trim();
                  if (val) cssVars[prop] = val;
                }
              }
            }
          }
        } catch (e) {}
      }
    } catch (e) {}

    const allElements = document.querySelectorAll("*");
    let totalScanned = 0;

    allElements.forEach((el, idx) => {
      if (!(el instanceof HTMLElement)) return;
      totalScanned++;
      
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const area = rect.width * rect.height;
      const tag = el.tagName.toLowerCase();
      
      if (!isVisible(el)) return;

      const r = normalizeUnit(style.borderRadius);
      const s = style.boxShadow;
      if (r && r !== "0px") radiiSet.add(r);
      if (s && s !== "none") shadowsSet.add(s);

      if (area > 1000) {
        const pt = normalizeUnit(style.paddingTop);
        const mt = normalizeUnit(style.marginTop);
        if (pt && pt !== "0px") spacingSet.add(pt);
        if (mt && mt !== "0px") spacingSet.add(mt);
      }

      const bgImg = style.backgroundImage;
      if (bgImg && bgImg.includes("gradient")) gradientsSet.add(bgImg);

      const effectiveBg = getEffectiveBackground(el);
      const fg = rgbToHex(style.color);
      
      const isHeading = /^h[1-6]$/.test(tag);
      const isButton = tag === "button" || el.closest("button") || el.getAttribute("role") === "button";
      const isCard = area > 5000 && (style.boxShadow !== "none" || style.borderRadius !== "0px" || effectiveBg !== getEffectiveBackground(el.parentElement || el));

      const processColor = (hex: string, role: string) => {
        if (hex === "transparent" || !hex.startsWith("#")) return;
        
        let weight = area;
        if (role === "text" && area < 500) weight *= 0.1;
        if (isButton) weight *= 15;
        if (isHeading) weight *= 3;
        if (tag === "body" || tag === "main") weight *= 2;

        let stats = colorStats.get(hex);
        if (!stats) {
          stats = { count: 0, area: 0, roles: new Set(), elements: new Set(), isHeading: false, isButton: false, confidence: "confirmed" };
          colorStats.set(hex, stats);
        }
        stats.count++;
        stats.area += weight;
        stats.roles.add(role);
        if (isHeading) stats.isHeading = true;
        if (isButton) stats.isButton = true;
      };

      processColor(effectiveBg, "background");
      processColor(fg, "text");

      if (area > viewportArea * 0.05) {
        let role: any = "section_surface";
        if (tag === "body" || (tag === "div" && idx < 5 && area > viewportArea * 0.8)) role = "page_canvas";
        else if (tag === "header" || (isHeading && area > viewportArea * 0.2)) role = "hero_surface";
        else if (isCard) role = "card_surface";
        else if (tag === "footer") role = "footer_surface";

        surfaces.push({
          role,
          background: effectiveBg,
          text: fg,
          areaWeight: area / viewportArea
        });
      }

      const family = style.fontFamily;
      const size = normalizeUnit(style.fontSize);
      const weight = style.fontWeight;
      const lh = normalizeUnit(style.lineHeight);
      const typeKey = `${family}|${size}|${weight}|${lh}|${fg}`;
      let tStats = typographyUsage.get(typeKey);
      if (!tStats) {
        tStats = { family, size, weight, lineHeight: lh, color: fg, count: 0, tags: new Set() };
        typographyUsage.set(typeKey, tStats);
      }
      tStats.count++;
      tStats.tags.add(tag);
    });

    const sortedColors = [...colorStats.entries()].sort((a, b) => b[1].area - a[1].area);
    const palette = {
      primary: [] as string[],
      secondary: [] as string[],
      accent: [] as string[],
      background: [] as string[],
      surface: [] as string[],
      text: [] as string[],
      muted: [] as string[],
      allObserved: sortedColors.map(([hex, s]) => ({
        hex,
        areaWeight: s.area / viewportArea,
        frequency: s.count,
        roles: [...s.roles],
        confidence: s.confidence
      }))
    };

    sortedColors.forEach(([hex, s]) => {
      if (s.isHeading && s.area > viewportArea * 0.01) palette.primary.push(hex);
      if (s.isButton) palette.accent.push(hex);
      if (s.roles.has("background") && s.area > viewportArea * 0.15) palette.background.push(hex);
      if (s.roles.has("background") && s.area <= viewportArea * 0.15 && s.area > viewportArea * 0.02) palette.surface.push(hex);
      if (s.roles.has("text") && !palette.primary.includes(hex)) palette.text.push(hex);
    });

    const uniq = (arr: string[]) => [...new Set(arr)].slice(0, 5);
    palette.primary = uniq(palette.primary);
    palette.accent = uniq(palette.accent);
    palette.background = uniq(palette.background);
    palette.text = uniq(palette.text);

    return {
      run_id: runId,
      url,
      generated_at: new Date().toISOString(),
      palette,
      gradients: [...gradientsSet].slice(0, 5),
      typography: {
        display: uniq([...typographyUsage.values()].filter(t => [...t.tags].some(tag => /^h[1-3]$/.test(tag))).map(t => t.family)),
        body: uniq([...typographyUsage.values()].filter(t => [...t.tags].includes("p") || [...t.tags].includes("div")).map(t => t.family)),
        ui: uniq([...typographyUsage.values()].filter(t => [...t.tags].includes("button") || [...t.tags].includes("span")).map(t => t.family)),
        scales: [...typographyUsage.values()]
          .sort((a, b) => b.count - a.count)
          .slice(0, 12)
          .map(t => ({
            tag: [...t.tags][0],
            role: (/^h[1-3]$/.test([...t.tags][0]) ? "display" : ([...t.tags].includes("button") ? "ui" : "body")) as "display" | "body" | "ui",
            fontSize: t.size,
            fontWeight: t.weight,
            lineHeight: t.lineHeight,
            color: t.color,
            usageCount: t.count,
          })),
      },
      spacing: [...spacingSet].sort((a, b) => parseFloat(a) - parseFloat(b)).slice(0, 12),
      radius: [...radiiSet].slice(0, 8),
      shadows: [...shadowsSet].slice(0, 6),
      surfaces: surfaces.slice(0, 10),
      buttons: {
        radius: radiiSet.size > 0 ? [...radiiSet][0] : "4px",
        paddingDensity: "normal" as "compact" | "normal" | "spacious",
        fillType: "solid" as "solid" | "outline" | "ghost" | "gradient",
        variants: []
      },
      mood: {
        confidence: 0.7,
      },
      resolvedCssVariables: cssVars,
      metrics: {
        totalElementsScanned: totalScanned,
        extractionDurationMs: 0,
        confidenceScore: totalScanned > 100 ? 0.95 : 0.6,
      }
    };
  }, { runId, url: page.url() });

  manifest.metrics.extractionDurationMs = Date.now() - startTime;
  return manifest;
}

/**
 * Resizes the screenshot to a 5x5 grid and extracts dominant pixel colors to get the visual "atmosphere".
 */
async function analyzeScreenshotDominantColors(screenshotPath: string): Promise<string[]> {
  const { data, info } = await sharp(screenshotPath)
    .resize(5, 5, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const colors = new Set<string>();
  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i].toString(16).padStart(2, "0");
    const g = data[i + 1].toString(16).padStart(2, "0");
    const b = data[i + 2].toString(16).padStart(2, "0");
    const hex = `#${r}${g}${b}`;
    colors.add(hex);
  }
  return [...colors];
}

/**
 * Merges visual colors into the semantic manifest if they are significant but missing.
 */
function rebalancePaletteWithVisuals(manifest: StyleMdDesignTokenManifest, visualColors: string[]) {
  visualColors.forEach(v => {
    const alreadyPresent = manifest.palette.primary.includes(v) || manifest.palette.background.includes(v);
    if (!alreadyPresent) {
      const isNew = !manifest.palette.allObserved.some(o => o.hex === v && o.areaWeight > 0.3);
      if (isNew) {
        manifest.palette.background.unshift(v);
        manifest.palette.allObserved.push({
          hex: v,
          areaWeight: 0.5,
          frequency: 1,
          roles: ["background", "visual_atmosphere"],
          confidence: "inferred"
        });
      }
    }
  });
}

/**
 * PHASE 2: Full-Page Semantic Analysis
 * Identifies sections and classifies them (Navbar, Hero, etc.) to provide structural context.
 */
async function analyzeSemanticStructure(
  page: Page, 
  runId: string, 
  candidates: StyleMdCandidate[]
): Promise<StyleMdSemanticStructure> {
  return page.evaluate(({ runId, url, candidates }) => {
    // @ts-ignore
    const __name = (t, v) => t;

    const sections: StyleMdSemanticSection[] = [];
    const layoutPatterns = {
      isStickyHeader: false,
      hasSidebar: false,
      isCenterAligned: true,
    };

    function rgbToHex(rgb: string): string {
      if (!rgb || rgb === "transparent" || rgb === "rgba(0, 0, 0, 0)") return "transparent";
      const match = rgb.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/);
      if (!match) return rgb;
      const r = parseInt(match[1]).toString(16).padStart(2, "0");
      const g = parseInt(match[2]).toString(16).padStart(2, "0");
      const b = parseInt(match[3]).toString(16).padStart(2, "0");
      return `#${r}${g}${b}`;
    }

    function getRect(el: Element): any {
      const r = el.getBoundingClientRect();
      return {
        top: r.top + window.scrollY,
        left: r.left + window.scrollX,
        width: r.width,
        height: r.height,
        bottom: r.top + r.height + window.scrollY,
      };
    }

    const containers = Array.from(document.querySelectorAll("header, footer, main, nav, section, [role='main'], [role='banner'], [role='contentinfo']"));
    
    if (containers.length < 3) {
      const bodyChildren = Array.from(document.body.children);
      bodyChildren.forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.height > 100 && rect.width > window.innerWidth * 0.5) {
          containers.push(el);
        }
      });
    }

    containers.forEach((el, idx) => {
      if (!(el instanceof HTMLElement)) return;
      
      const tag = el.tagName.toLowerCase();
      const role = el.getAttribute("role") || "";
      const rect = getRect(el);
      const style = window.getComputedStyle(el);
      
      let classification: StyleMdSemanticSection["classification"] = "unknown";
      const text = el.innerText || el.textContent || "";
      const textLower = text.toLowerCase();
      
      if (tag === "header" || role === "banner" || el.querySelector("nav")) classification = "navbar";
      else if (tag === "footer" || role === "contentinfo") classification = "footer";
      else if (idx === 0 || el.querySelector("h1")) classification = "hero";
      else if (textLower.includes("pricing") || textLower.includes("$")) classification = "pricing";
      else if (textLower.includes("feature") || textLower.includes("benefit")) classification = "features";
      
      const localBackground = rgbToHex(style.backgroundColor);
      const localText = rgbToHex(style.color);

      const childCandidateIds = candidates
        .filter(c => {
          const cEl = document.querySelector(`[data-stylemd-candidate-id="${c.candidateId}"]`);
          return cEl && el.contains(cEl);
        })
        .map(c => c.candidateId);

      sections.push({
        id: `section_${idx + 1}`,
        tagName: tag,
        role,
        classification,
        rect,
        depth: 0,
        childCandidateIds,
        // @ts-ignore
        localContext: {
          background: localBackground,
          color: localText,
          padding: style.padding,
        }
      });

      if (classification === "navbar") {
        if (style.position === "fixed" || style.position === "sticky") {
          layoutPatterns.isStickyHeader = true;
        }
      }
    });

    return {
      run_id: runId,
      url,
      sections,
      layoutPatterns,
    };
  }, { runId, url: page.url(), candidates });
}
