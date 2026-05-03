"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runCaptureStage = runCaptureStage;
exports.runExtractStage = runExtractStage;
exports.runDedupStage = runDedupStage;
exports.runCuratedResponsiveHoverEvidenceStage = runCuratedResponsiveHoverEvidenceStage;
const node_crypto_1 = require("node:crypto");
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const sharp_1 = __importDefault(require("sharp"));
const ssim_js_1 = require("ssim.js");
const artifacts_1 = require("@/lib/stylemd-artifacts/artifacts");
const helpers_1 = require("@/lib/stylemd-artifacts/helpers");
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
];
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
];
const STYLEMD_SCREENSHOT_DOWNSAMPLE_RATIO = 0.7;
const STYLEMD_SCREENSHOT_MAX_WIDTH = 1800;
const STYLEMD_SCREENSHOT_MAX_HEIGHT = 5000;
const PSEUDO_CRITICAL_PROPERTIES = [
    "content",
    ...AGENT_STYLE_PROPERTIES,
];
const STYLEMD_OVERLAY_HIDE_ATTR = "data-stylemd-hidden-overlay";
const STYLEMD_OVERLAY_HIDE_STYLE_ID = "stylemd-hidden-overlay-style";
const STYLEMD_OVERLAY_GUARD_KEY = "__stylemdOverlayGuard__";
const STYLEMD_CHROME_HIDE_ATTR = "data-stylemd-hidden-chrome";
const STYLEMD_CHROME_HIDE_STYLE_ID = "stylemd-hidden-chrome-style";
function toRunRelative(runId, absolutePath) {
    const runDir = (0, artifacts_1.getStyleMdRunDir)(runId);
    return (0, node_path_1.relative)(runDir, absolutePath).split("\\").join("/");
}
async function waitForSettledPage(page, signal) {
    (0, helpers_1.assertNotAborted)(signal);
    await page.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => undefined);
    await page.waitForLoadState("load", { timeout: 30000 }).catch(() => undefined);
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => undefined);
    await page.waitForTimeout(400);
    (0, helpers_1.assertNotAborted)(signal);
    await page.evaluate(async () => {
        // @ts-ignore
        const __name = (t, v) => t;
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const waitForFonts = async (timeoutMs) => {
            const fontSet = document.fonts;
            if (!fontSet?.ready) {
                return;
            }
            try {
                await Promise.race([
                    fontSet.ready,
                    sleep(timeoutMs),
                ]);
            }
            catch {
                // Best-effort only. Missing/failed fonts should not crash capture.
            }
        };
        const waitForImages = async (timeoutMs) => {
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
                const eventPromise = new Promise((resolve) => {
                    const done = () => resolve();
                    image.addEventListener("load", done, { once: true });
                    image.addEventListener("error", done, { once: true });
                });
                const decodePromise = typeof image.decode === "function" ? image.decode().then(() => undefined).catch(() => undefined) : Promise.resolve();
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
        await waitForFonts(2500);
        await waitForImages(6000);
        const metric = () => {
            const height = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
            const pendingImages = Array.from(document.images ?? []).filter((image) => !image.complete).length;
            const fontStatus = document.fonts?.status ?? "unknown";
            return `${height}:${pendingImages}:${fontStatus}`;
        };
        let stableFrames = 0;
        let lastMetric = metric();
        const stabilityDeadline = Date.now() + 1800;
        while (Date.now() < stabilityDeadline && stableFrames < 3) {
            await sleep(120);
            const nextMetric = metric();
            if (nextMetric === lastMetric) {
                stableFrames += 1;
            }
            else {
                stableFrames = 0;
                lastMetric = nextMetric;
            }
        }
        window.scrollTo(0, 0);
        await sleep(180);
        await waitForFonts(1500);
        await waitForImages(2500);
    });
    (0, helpers_1.assertNotAborted)(signal);
    await page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => undefined);
    await page.waitForTimeout(200);
    (0, helpers_1.assertNotAborted)(signal);
}
async function runOverlayHygiene(page, signal) {
    (0, helpers_1.assertNotAborted)(signal);
    await page.evaluate(({ hideAttr, styleId, guardKey }) => {
        // @ts-ignore
        const __name = (t, v) => t;
        if (!document.getElementById(styleId)) {
            const style = document.createElement("style");
            style.id = styleId;
            style.textContent = `[${hideAttr}="1"]{visibility:hidden !important;opacity:0 !important;pointer-events:none !important;}`;
            document.head.appendChild(style);
        }
        const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1;
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 1;
        const viewportArea = Math.max(viewportWidth * viewportHeight, 1);
        const toNumber = (value) => {
            const parsed = Number.parseFloat(value);
            return Number.isFinite(parsed) ? parsed : 0;
        };
        const hasKeyword = (value) => /(modal|popup|newsletter|cookie|consent|gdpr|subscribe|age.?gate|intercom|chat|klaviyo|privy|overlay|drawer|discount)/i.test(value);
        const isVisible = (style, rect) => {
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
        const shouldHide = (element, style, rect) => {
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
            const semanticModal = (element.tagName.toLowerCase() === "dialog" || role === "dialog" || role === "alertdialog" || ariaModal || hasKeyword(metaText)) &&
                (fixedLike || elevatedZ);
            const fullScreenOverlay = fixedLike &&
                elevatedZ &&
                rect.left <= 4 &&
                rect.top <= 4 &&
                rect.right >= viewportWidth - 4 &&
                rect.bottom >= viewportHeight - 4;
            const centeredOverlay = fixedLike &&
                elevatedZ &&
                areaRatio >= 0.12 &&
                areaRatio <= 0.9 &&
                rect.top <= viewportHeight * 0.85 &&
                rect.bottom >= viewportHeight * 0.15 &&
                rect.left <= viewportWidth * 0.9 &&
                rect.right >= viewportWidth * 0.1;
            const bottomOverlay = fixedLike &&
                elevatedZ &&
                rect.bottom >= viewportHeight - 2 &&
                rect.height <= viewportHeight * 0.45 &&
                rect.width >= 100;
            const cornerWidget = fixedLike &&
                elevatedZ &&
                rect.bottom >= viewportHeight - 2 &&
                (rect.right >= viewportWidth - 2 || rect.left <= 2) &&
                rect.width <= 180 &&
                rect.height <= 180;
            const blockingLayer = fixedLike && elevatedZ && areaRatio >= 0.85;
            return semanticModal || fullScreenOverlay || centeredOverlay || bottomOverlay || cornerWidget || blockingLayer;
        };
        const markHidden = (element) => {
            if (element.getAttribute(hideAttr) === "1") {
                return false;
            }
            element.setAttribute(hideAttr, "1");
            return true;
        };
        const scanElement = (element) => {
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
        const scanIframe = (iframe) => {
            const style = window.getComputedStyle(iframe);
            const rect = iframe.getBoundingClientRect();
            if (!isVisible(style, rect)) {
                return 0;
            }
            const position = style.position;
            const fixedLike = position === "fixed" || position === "sticky";
            const z = toNumber(style.zIndex);
            const areaRatio = (rect.width * rect.height) / viewportArea;
            const cornerWidget = fixedLike &&
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
        const scanNodeTree = (root) => {
            let hiddenCount = 0;
            if (root instanceof HTMLElement) {
                if (root instanceof HTMLIFrameElement) {
                    hiddenCount += scanIframe(root);
                }
                else {
                    hiddenCount += scanElement(root);
                }
            }
            if (root instanceof Element) {
                const descendants = root.querySelectorAll("*");
                for (const node of descendants) {
                    if (node instanceof HTMLIFrameElement) {
                        hiddenCount += scanIframe(node);
                    }
                    else if (node instanceof HTMLElement) {
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
            const looksLikeClose = /close|dismiss|not now|no thanks|skip|×|✕|✖/.test(label) ||
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
        const globalWithGuard = window;
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
    }, {
        hideAttr: STYLEMD_OVERLAY_HIDE_ATTR,
        styleId: STYLEMD_OVERLAY_HIDE_STYLE_ID,
        guardKey: STYLEMD_OVERLAY_GUARD_KEY,
    });
    (0, helpers_1.assertNotAborted)(signal);
}
async function suppressStickyChromeForComponentScreenshot(page, candidateId, signal) {
    (0, helpers_1.assertNotAborted)(signal);
    await page.evaluate(({ candidateId, hideAttr, styleId }) => {
        // @ts-ignore
        const __name = (t, v) => t;
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
        const toNumber = (value) => {
            const parsed = Number.parseFloat(value);
            return Number.isFinite(parsed) ? parsed : 0;
        };
        const intersects = (a, b) => !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
        const maybeChromeText = (element) => [
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
    }, {
        candidateId,
        hideAttr: STYLEMD_CHROME_HIDE_ATTR,
        styleId: STYLEMD_CHROME_HIDE_STYLE_ID,
    });
    (0, helpers_1.assertNotAborted)(signal);
}
async function restoreSuppressedStickyChrome(page) {
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
function buildComponentId(candidate, index) {
    const hash = (0, node_crypto_1.createHash)("sha1")
        .update(`${candidate.selector}|${candidate.rect.top}|${candidate.rect.height}|${index}`)
        .digest("hex")
        .slice(0, 8);
    return `${String(index + 1).padStart(4, "0")}_${hash}`;
}
function safeCssName(input) {
    return input
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 64) || "stylesheet";
}
function shouldCompareDimensions(a, b) {
    const widthDelta = Math.abs(a.rect.width - b.rect.width);
    const heightDelta = Math.abs(a.rect.height - b.rect.height);
    return widthDelta <= 2 && heightDelta <= 2;
}
async function readImageData(path, width, height) {
    const input = width && height
        ? (0, sharp_1.default)(path).resize(width, height, { fit: "fill" }).ensureAlpha().raw()
        : (0, sharp_1.default)(path).ensureAlpha().raw();
    const { data, info } = await input.toBuffer({ resolveWithObject: true });
    return {
        width: info.width,
        height: info.height,
        data: new Uint8ClampedArray(data),
    };
}
async function compareImagesWithSsim(pathA, pathB) {
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
    const { mssim } = (0, ssim_js_1.ssim)({
        data: a.data,
        width: a.width,
        height: a.height,
    }, {
        data: b.data,
        width: b.width,
        height: b.height,
    }, {
        ssim: "weber",
        maxSize: 512,
        downsample: "fast",
    });
    return mssim;
}
async function downsampleScreenshot(buffer) {
    const image = (0, sharp_1.default)(buffer);
    const metadata = await image.metadata();
    const sourceWidth = metadata.width ?? 0;
    const sourceHeight = metadata.height ?? 0;
    if (sourceWidth <= 0 || sourceHeight <= 0) {
        return buffer;
    }
    const targetWidth = Math.max(1, Math.min(STYLEMD_SCREENSHOT_MAX_WIDTH, Math.round(sourceWidth * STYLEMD_SCREENSHOT_DOWNSAMPLE_RATIO)));
    const targetHeight = Math.max(1, Math.min(STYLEMD_SCREENSHOT_MAX_HEIGHT, Math.round(sourceHeight * STYLEMD_SCREENSHOT_DOWNSAMPLE_RATIO)));
    return image
        .resize({
        width: targetWidth,
        height: targetHeight,
        fit: "inside",
        withoutEnlargement: true,
        kernel: sharp_1.default.kernel.lanczos3,
    })
        .png({
        compressionLevel: 9,
    })
        .toBuffer();
}
async function runCaptureStage(input) {
    const { runId, page, signal } = input;
    await waitForSettledPage(page, signal);
    (0, helpers_1.assertNotAborted)(signal);
    await runOverlayHygiene(page, signal);
    (0, helpers_1.assertNotAborted)(signal);
    const viewport = page.viewportSize() ?? { width: 1366, height: 900 };
    const documentHeight = await page.evaluate(() => {
        // @ts-ignore
        const __name = (t, v) => t;
        return Math.max(document.body?.scrollHeight ?? 0, document.documentElement?.scrollHeight ?? 0, document.body?.offsetHeight ?? 0, document.documentElement?.offsetHeight ?? 0);
    });
    const screenshot = await page.screenshot({
        fullPage: true,
        type: "png",
        animations: "disabled",
    });
    const downsampledScreenshot = await downsampleScreenshot(screenshot);
    const screenshotArtifact = await (0, artifacts_1.writeStyleMdImage)(runId, "full_screenshot.png", downsampledScreenshot);
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
const FONT_FORMAT_TO_EXTENSION = {
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
function stripCssQuotes(value) {
    const trimmed = value.trim();
    if (!trimmed) {
        return trimmed;
    }
    if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
        return trimmed.slice(1, -1).trim();
    }
    return trimmed;
}
function safeFontSlug(value) {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 64) || "font";
}
function parseFontFaceDeclarations(input) {
    const { cssText, sourceHref, sourceId } = input;
    const faces = [];
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
                }
                catch {
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
function decodeDataUrlToBuffer(dataUrl) {
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
function inferFontExtension(input) {
    const normalizedFormat = (input.format ?? "").toLowerCase().trim();
    if (normalizedFormat && FONT_FORMAT_TO_EXTENSION[normalizedFormat]) {
        return FONT_FORMAT_TO_EXTENSION[normalizedFormat];
    }
    const mime = (input.mimeType ?? "").toLowerCase();
    if (mime.includes("woff2"))
        return "woff2";
    if (mime.includes("woff"))
        return "woff";
    if (mime.includes("truetype") || mime.includes("ttf"))
        return "ttf";
    if (mime.includes("opentype") || mime.includes("otf"))
        return "otf";
    if (mime.includes("eot") || mime.includes("ms-fontobject"))
        return "eot";
    if (mime.includes("svg"))
        return "svg";
    if (!input.resolvedSource.toLowerCase().startsWith("data:")) {
        try {
            const extension = (0, node_path_1.extname)(new URL(input.resolvedSource).pathname).toLowerCase().replace(".", "");
            if (extension && /^[a-z0-9]{2,8}$/.test(extension)) {
                return extension;
            }
        }
        catch {
            // Ignore URL parse failures and fall through.
        }
    }
    return "bin";
}
function buildLocalFontCss(entries, runId) {
    const groups = new Map();
    const localized = entries
        .filter((entry) => entry.status === "localized" && entry.localArtifactPath)
        .sort((a, b) => a.id.localeCompare(b.id));
    for (const entry of localized) {
        const localPath = entry.localArtifactPath;
        if (!localPath) {
            continue;
        }
        const cssRelativePath = (0, node_path_1.relative)("page_styles", toRunRelative(runId, localPath).replace(/\\/g, "/")).replace(/\\/g, "/");
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
        if (familyCmp !== 0)
            return familyCmp;
        const weightCmp = a.weight.localeCompare(b.weight);
        if (weightCmp !== 0)
            return weightCmp;
        return a.style.localeCompare(b.style);
    });
    const lines = [];
    for (const group of orderedGroups) {
        const uniqueSources = new Map();
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
async function localizeFontAssets(input) {
    const { runId, page, signal, cssSources } = input;
    const artifacts = [];
    const parsedFaces = cssSources.flatMap((source) => parseFontFaceDeclarations({
        cssText: source.cssText,
        sourceHref: source.sourceHref,
        sourceId: source.sourceId,
    }));
    const hashToArtifactPath = new Map();
    const sourceCache = new Map();
    const entries = [];
    let counter = 0;
    for (const face of parsedFaces) {
        (0, helpers_1.assertNotAborted)(signal);
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
                }
                else {
                    try {
                        const response = await page.request.get(face.resolvedSource, {
                            timeout: 20000,
                        });
                        if (!response.ok()) {
                            cached = {
                                ok: false,
                                error: `HTTP ${response.status()}`,
                            };
                        }
                        else {
                            const headers = response.headers();
                            cached = {
                                ok: true,
                                buffer: Buffer.from(await response.body()),
                                mimeType: headers["content-type"]?.split(";")[0]?.trim(),
                            };
                        }
                    }
                    catch (error) {
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
            const hash = (0, node_crypto_1.createHash)("sha256").update(cached.buffer).digest("hex");
            let artifactPath = hashToArtifactPath.get(hash);
            if (!artifactPath) {
                const extension = inferFontExtension({
                    resolvedSource: face.resolvedSource,
                    mimeType: cached.mimeType,
                    format: face.format,
                });
                const fileName = `${safeFontSlug(face.family)}_${hash.slice(0, 16)}.${extension}`;
                const artifact = await (0, artifacts_1.writeStyleMdBinary)(runId, (0, node_path_1.join)("page_styles", "fonts", fileName), cached.buffer);
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
        }
        catch (error) {
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
    const localCssArtifact = await (0, artifacts_1.writeStyleMdText)(runId, (0, node_path_1.join)("page_styles", "fonts.local.css"), localCss, "css");
    artifacts.push(localCssArtifact);
    const families = new Map();
    for (const entry of entries) {
        if (entry.status !== "localized") {
            continue;
        }
        const key = entry.family.trim();
        families.set(key, (families.get(key) ?? 0) + 1);
    }
    const manifest = {
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
    const manifestArtifact = await (0, artifacts_1.writeStyleMdJson)(runId, (0, node_path_1.join)("page_styles", "fonts.manifest.json"), manifest);
    artifacts.push(manifestArtifact);
    return {
        manifest,
        manifestArtifact,
        localCssArtifact,
        artifacts,
    };
}
async function collectPageStyles(input) {
    const { runId, page, signal } = input;
    (0, helpers_1.assertNotAborted)(signal);
    const stylesMeta = await page.evaluate(() => {
        // @ts-ignore
        const __name = (t, v) => t;
        const inlineStyles = Array.from(document.querySelectorAll("style")).map((node, index) => ({
            id: `inline_${index + 1}`,
            text: node.textContent ?? "",
        }));
        const linkedStyles = Array.from(document.querySelectorAll('link[rel~="stylesheet"]')).map((node, index) => {
            const href = node.getAttribute("href") ?? "";
            const absoluteHref = node.href || href;
            return {
                id: `linked_${index + 1}`,
                href: absoluteHref,
            };
        });
        const stylesheetInventory = Array.from(document.styleSheets).map((sheet, index) => {
            let readableRuleCount = null;
            try {
                readableRuleCount = sheet.cssRules?.length ?? null;
            }
            catch {
                readableRuleCount = null;
            }
            const mediaText = sheet.media?.mediaText ?? "all";
            const ownerNodeName = sheet.ownerNode?.nodeName ?? null;
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
    const artifacts = [];
    const cssSources = [];
    const pageUrl = page.url();
    const inlineStyles = [];
    for (const inline of stylesMeta.inlineStyles) {
        (0, helpers_1.assertNotAborted)(signal);
        const artifact = await (0, artifacts_1.writeStyleMdText)(runId, (0, node_path_1.join)("page_styles", `${inline.id}.css`), inline.text, "css");
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
    const linkedStyles = [];
    for (const linked of stylesMeta.linkedStyles) {
        (0, helpers_1.assertNotAborted)(signal);
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
                timeout: 20000,
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
            const fileName = `${linked.id}_${safeCssName((0, node_path_1.basename)(new URL(linked.href).pathname))}.css`;
            const artifact = await (0, artifacts_1.writeStyleMdText)(runId, (0, node_path_1.join)("page_styles", fileName), text, "css");
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
        }
        catch (error) {
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
    const bundle = {
        inlineStyles,
        linkedStyles,
        stylesheetInventory: stylesMeta.stylesheetInventory,
        fontsManifestPath: localizedFonts.manifestArtifact.path,
        fontsLocalCssPath: localizedFonts.localCssArtifact.path,
    };
    const indexArtifact = await (0, artifacts_1.writeStyleMdJson)(runId, (0, node_path_1.join)("page_styles", "index.json"), bundle);
    artifacts.push(indexArtifact);
    return {
        result: bundle,
        artifacts,
    };
}
async function discoverCandidates(input) {
    const { page, widthThreshold, minHeightPx, signal } = input;
    (0, helpers_1.assertNotAborted)(signal);
    const candidates = await page.evaluate(({ tags, widthThresholdPct, minHeight }) => {
        // @ts-ignore
        const __name = (t, v) => t;
        function cssEscape(value) {
            if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
                return CSS.escape(value);
            }
            return value.replace(/[^a-zA-Z0-9_\-]/g, "\\$&");
        }
        function buildSelector(el) {
            if (el.id) {
                return `#${cssEscape(el.id)}`;
            }
            const parts = [];
            let current = el;
            let depth = 0;
            while (current && current !== document.body && depth < 5) {
                const tag = current.tagName.toLowerCase();
                const classNames = Array.from(current.classList).slice(0, 3).map((className) => cssEscape(className));
                const classHint = classNames.length > 0 ? `.${classNames.join(".")}` : "";
                let part = `${tag}${classHint}`;
                const parent = current.parentElement;
                if (parent) {
                    const siblings = Array.from(parent.children).filter((sibling) => sibling.tagName === current.tagName);
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
        const found = [];
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
    }, {
        tags: FULL_WIDTH_TAGS,
        widthThresholdPct: widthThreshold,
        minHeight: minHeightPx,
    });
    return candidates;
}
async function extractComponentPayload(page, candidateId) {
    return page.evaluate(({ candidateId, styleTreeProperties, agentStyleProperties, pseudoCriticalProperties }) => {
        // @ts-ignore
        const __name = (t, v) => t;
        function styleObject(style) {
            const output = {};
            for (let i = 0; i < style.length; i += 1) {
                const prop = style[i];
                output[prop] = style.getPropertyValue(prop);
            }
            return output;
        }
        function pickStyles(style, keys) {
            const output = {};
            for (const key of keys) {
                const value = style.getPropertyValue(key);
                if (value) {
                    output[key] = value;
                }
            }
            return output;
        }
        function normalizeColor(value) {
            return value.replace(/\s+/g, "").toLowerCase();
        }
        function hasVisibleBackground(style) {
            const value = style.getPropertyValue("background-color");
            if (!value) {
                return false;
            }
            const normalized = normalizeColor(value);
            return normalized !== "transparent" && normalized !== "rgba(0,0,0,0)";
        }
        function hasBorder(style) {
            const borderTop = Number.parseFloat(style.getPropertyValue("border-top-width") || "0");
            const borderRight = Number.parseFloat(style.getPropertyValue("border-right-width") || "0");
            const borderBottom = Number.parseFloat(style.getPropertyValue("border-bottom-width") || "0");
            const borderLeft = Number.parseFloat(style.getPropertyValue("border-left-width") || "0");
            return borderTop > 0 || borderRight > 0 || borderBottom > 0 || borderLeft > 0;
        }
        function isSignificantNode(element, style, textSample, isRoot) {
            if (isRoot) {
                return true;
            }
            const tag = element.tagName.toLowerCase();
            if (tag === "a" ||
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
                /^h[1-6]$/.test(tag)) {
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
        function sanitizeDomForAgent(root) {
            const clone = root.cloneNode(true);
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
        function buildPseudoAgentStyles(rootStyle, pseudoStyle) {
            const output = {};
            for (const key of pseudoCriticalProperties) {
                const pseudoValue = pseudoStyle.getPropertyValue(key);
                if (!pseudoValue) {
                    continue;
                }
                if (key === "content") {
                    const normalized = pseudoValue.trim();
                    if (normalized &&
                        normalized !== "none" &&
                        normalized !== "normal" &&
                        normalized !== "\"\"" &&
                        normalized !== "''") {
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
        function nodePath(node) {
            const path = [];
            let current = node;
            while (current && current !== document.body) {
                const nodeAtDepth = current;
                let part = nodeAtDepth.tagName.toLowerCase();
                if (nodeAtDepth.id) {
                    part += `#${nodeAtDepth.id}`;
                }
                else {
                    const siblings = nodeAtDepth.parentElement
                        ? Array.from(nodeAtDepth.parentElement.children).filter((sibling) => sibling.tagName === nodeAtDepth.tagName)
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
        function collectCssRuleRefs(root) {
            const refs = [];
            function inspectRule(rule, stylesheetIndex, stylesheetHref) {
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
                    }
                    catch {
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
                }
                catch {
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
        const styleTree = [];
        const agentStyleTree = [];
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
        let current = walker.currentNode;
        while (current) {
            const element = current;
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
        const uniqueAgentStyleTree = [];
        const seenNodePaths = new Set();
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
    }, {
        candidateId,
        styleTreeProperties: [...STYLE_TREE_PROPERTIES],
        agentStyleProperties: [...AGENT_STYLE_PROPERTIES],
        pseudoCriticalProperties: [...PSEUDO_CRITICAL_PROPERTIES],
    });
}
async function runExtractStage(input) {
    const { runId, page, config, signal } = input;
    (0, helpers_1.assertNotAborted)(signal);
    await runOverlayHygiene(page, signal);
    (0, helpers_1.assertNotAborted)(signal);
    const artifacts = [];
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
    const candidatesArtifact = await (0, artifacts_1.writeStyleMdJson)(runId, (0, node_path_1.join)("components", "candidates.json"), {
        widthThreshold: config.widthThreshold,
        minHeightPx: config.minHeightPx,
        candidateCount: candidates.length,
        candidates,
    });
    artifacts.push(candidatesArtifact);
    const components = [];
    for (let i = 0; i < candidates.length; i += 1) {
        (0, helpers_1.assertNotAborted)(signal);
        const candidate = candidates[i];
        const componentId = buildComponentId(candidate, i);
        const componentDir = (0, node_path_1.join)("components", componentId);
        const locator = page.locator(`[data-stylemd-candidate-id="${candidate.candidateId}"]`).first();
        const count = await locator.count();
        if (count === 0) {
            continue;
        }
        const payload = await extractComponentPayload(page, candidate.candidateId);
        if (!payload.found) {
            continue;
        }
        await locator.scrollIntoViewIfNeeded({ timeout: 10000 }).catch(() => undefined);
        await runOverlayHygiene(page, signal);
        await suppressStickyChromeForComponentScreenshot(page, candidate.candidateId, signal);
        (0, helpers_1.assertNotAborted)(signal);
        let screenshotBuffer;
        try {
            screenshotBuffer = await locator.screenshot({
                type: "png",
                animations: "disabled",
            });
        }
        catch {
            continue;
        }
        finally {
            await restoreSuppressedStickyChrome(page);
        }
        const downsampledComponentScreenshot = await downsampleScreenshot(screenshotBuffer);
        const screenshotArtifact = await (0, artifacts_1.writeStyleMdImage)(runId, (0, node_path_1.join)(componentDir, "screenshot.png"), downsampledComponentScreenshot);
        artifacts.push(screenshotArtifact);
        const domArtifact = await (0, artifacts_1.writeStyleMdText)(runId, (0, node_path_1.join)(componentDir, "dom.html"), payload.domHtml ?? "", "html");
        const domAgentArtifact = await (0, artifacts_1.writeStyleMdText)(runId, (0, node_path_1.join)(componentDir, "dom.agent.html"), payload.agentDomHtml ?? "", "html");
        const stylesArtifact = await (0, artifacts_1.writeStyleMdJson)(runId, (0, node_path_1.join)(componentDir, "styles.json"), payload.computedStyles ?? {});
        const stylesAgentArtifact = await (0, artifacts_1.writeStyleMdJson)(runId, (0, node_path_1.join)(componentDir, "styles.agent.json"), payload.agentStyles ?? {});
        const styleTreeArtifact = await (0, artifacts_1.writeStyleMdJson)(runId, (0, node_path_1.join)(componentDir, "style_tree.json"), payload.styleTree ?? []);
        const styleTreeAgentArtifact = await (0, artifacts_1.writeStyleMdJson)(runId, (0, node_path_1.join)(componentDir, "style_tree.agent.json"), payload.agentStyleTree ?? []);
        const pseudoStylesArtifact = await (0, artifacts_1.writeStyleMdJson)(runId, (0, node_path_1.join)(componentDir, "pseudo_styles.json"), payload.pseudoStyles ?? { before: {}, after: {} });
        const pseudoStylesAgentArtifact = await (0, artifacts_1.writeStyleMdJson)(runId, (0, node_path_1.join)(componentDir, "pseudo.agent.json"), payload.agentPseudoStyles ?? { before: {}, after: {} });
        const cssRuleRefsArtifact = await (0, artifacts_1.writeStyleMdJson)(runId, (0, node_path_1.join)(componentDir, "css_rule_refs.json"), payload.cssRuleRefs ?? []);
        artifacts.push(domArtifact, domAgentArtifact, stylesArtifact, stylesAgentArtifact, styleTreeArtifact, styleTreeAgentArtifact, pseudoStylesArtifact, pseudoStylesAgentArtifact, cssRuleRefsArtifact);
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
        const metadataArtifact = await (0, artifacts_1.writeStyleMdJson)(runId, (0, node_path_1.join)(componentDir, "metadata.json"), metadata);
        artifacts.push(metadataArtifact);
        components.push({
            componentId,
            candidateId: candidate.candidateId,
            selector: candidate.selector,
            tagName: candidate.tagName,
            rect: payload.rect ?? candidate.rect,
            directory: (0, node_path_1.dirname)(screenshotArtifact.path),
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
        // @ts-ignore
        const __name = (t, v) => t;
        for (const element of Array.from(document.querySelectorAll("[data-stylemd-candidate-id]"))) {
            element.removeAttribute("data-stylemd-candidate-id");
        }
    }).catch(() => undefined);
    const rawManifestArtifact = await (0, artifacts_1.writeStyleMdJson)(runId, (0, node_path_1.join)("components", "components_manifest.raw.json"), components);
    artifacts.push(rawManifestArtifact);
    const pageStylesIndexPath = pageStyles.artifacts.find((artifact) => artifact.name === (0, node_path_1.join)("page_styles", "index.json"))?.path ?? "";
    const fontsManifestPath = pageStyles.artifacts.find((artifact) => artifact.name === (0, node_path_1.join)("page_styles", "fonts.manifest.json"))?.path ?? "";
    const fontsLocalCssPath = pageStyles.artifacts.find((artifact) => artifact.name === (0, node_path_1.join)("page_styles", "fonts.local.css"))?.path ?? "";
    return {
        result: {
            candidatesPath: candidatesArtifact.path,
            rawManifestPath: rawManifestArtifact.path,
            pageStylesPath: pageStylesIndexPath,
            fontsManifestPath,
            fontsLocalCssPath,
            components,
            candidateCount: candidates.length,
        },
        artifacts,
    };
}
async function runDedupStage(input) {
    const { runId, components, threshold, signal } = input;
    (0, helpers_1.assertNotAborted)(signal);
    const artifacts = [];
    const sorted = [...components].sort((a, b) => {
        if (a.rect.top !== b.rect.top) {
            return a.rect.top - b.rect.top;
        }
        return a.rect.left - b.rect.left;
    });
    const kept = [];
    const duplicates = [];
    const deletedComponentIds = [];
    for (const component of sorted) {
        (0, helpers_1.assertNotAborted)(signal);
        let duplicatePair = null;
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
        await (0, promises_1.rm)(duplicate.directory, { recursive: true, force: true });
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
    const dedupManifestArtifact = await (0, artifacts_1.writeStyleMdJson)(runId, (0, node_path_1.join)("components", "components_manifest.deduped.json"), deduped);
    const dedupAgentManifestArtifact = await (0, artifacts_1.writeStyleMdJson)(runId, (0, node_path_1.join)("components", "components_manifest.agent.json"), {
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
    });
    const duplicatesArtifact = await (0, artifacts_1.writeStyleMdJson)(runId, (0, node_path_1.join)("components", "duplicates.json"), {
        threshold,
        duplicatePairs: duplicates,
        deletedComponentIds,
    });
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
    { name: "desktop", width: 1366, height: 900 },
    { name: "tablet", width: 1024, height: 1366 },
    { name: "mobile", width: 390, height: 844 },
];
function safeArtifactSegment(value) {
    return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}
async function runCuratedResponsiveHoverEvidenceStage(input) {
    const { runId, url, page, curatedManifest, signal } = input;
    (0, helpers_1.assertNotAborted)(signal);
    const artifacts = [];
    const evidence = {
        run_id: runId,
        url,
        generated_at: new Date().toISOString(),
        breakpoints: [],
    };
    for (const breakpoint of STYLEMD_CURATED_BREAKPOINTS) {
        (0, helpers_1.assertNotAborted)(signal);
        await page.setViewportSize({
            width: breakpoint.width,
            height: breakpoint.height,
        });
        await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: 90000,
        });
        await runOverlayHygiene(page, signal);
        const breakpointUnits = [];
        for (const unit of curatedManifest.units) {
            (0, helpers_1.assertNotAborted)(signal);
            const capturedComponents = [];
            for (const component of unit.components) {
                (0, helpers_1.assertNotAborted)(signal);
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
                const relativeBase = (0, node_path_1.join)("styleguide", "enrichment", breakpoint.name, safeArtifactSegment(unit.unit_id), safeArtifactSegment(component.componentId));
                const defaultRelPath = `${relativeBase}.default.png`;
                const hoverRelPath = `${relativeBase}.hover.png`;
                let hoverMethod = "none";
                let captureError;
                try {
                    await locator.scrollIntoViewIfNeeded({ timeout: 8000 });
                    await runOverlayHygiene(page, signal);
                    const defaultBuffer = await locator.screenshot({
                        type: "png",
                        animations: "disabled",
                    });
                    const downsampledDefaultBuffer = await downsampleScreenshot(defaultBuffer);
                    const defaultArtifact = await (0, artifacts_1.writeStyleMdImage)(runId, defaultRelPath, downsampledDefaultBuffer);
                    artifacts.push(defaultArtifact);
                    let hoverCaptured = false;
                    let cdpSession = null;
                    let cdpNodeId = null;
                    try {
                        const session = await page.context().newCDPSession(page);
                        cdpSession = session;
                        await session.send("DOM.enable");
                        await session.send("CSS.enable");
                        const docResult = await session.send("DOM.getDocument", { depth: -1, pierce: true });
                        const rootNodeId = docResult.root?.nodeId;
                        if (typeof rootNodeId !== "number") {
                            throw new Error("Failed to resolve DOM root node for pseudo-state forcing.");
                        }
                        const foundResult = await session.send("DOM.querySelector", {
                            nodeId: rootNodeId,
                            selector: component.selector,
                        });
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
                            const hoverArtifact = await (0, artifacts_1.writeStyleMdImage)(runId, hoverRelPath, downsampledHoverBuffer);
                            artifacts.push(hoverArtifact);
                            hoverMethod = "cdp_force_pseudo";
                            hoverCaptured = true;
                        }
                    }
                    catch {
                        // Fall through to Playwright hover fallback.
                    }
                    finally {
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
                        await locator.hover({ force: true, timeout: 5000 }).catch(() => undefined);
                        await runOverlayHygiene(page, signal);
                        const hoverBuffer = await locator.screenshot({
                            type: "png",
                            animations: "disabled",
                        });
                        const downsampledHoverBuffer = await downsampleScreenshot(hoverBuffer);
                        const hoverArtifact = await (0, artifacts_1.writeStyleMdImage)(runId, hoverRelPath, downsampledHoverBuffer);
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
                }
                catch (error) {
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
    const evidenceArtifact = await (0, artifacts_1.writeStyleMdJson)(runId, (0, node_path_1.join)("styleguide", "evidence.responsive_hover.json"), evidence);
    artifacts.push(evidenceArtifact);
    return {
        result: {
            evidencePath: evidenceArtifact.path,
            evidence,
        },
        artifacts,
    };
}
