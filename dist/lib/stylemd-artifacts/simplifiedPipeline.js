"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runSimplifiedStyleMdPipeline = runSimplifiedStyleMdPipeline;
const node_path_1 = require("node:path");
const playwright_1 = require("playwright");
const promises_1 = require("node:fs/promises");
const fileToBase64_1 = require("@/lib/utils/fileToBase64");
const artifacts_1 = require("@/lib/stylemd-artifacts/artifacts");
const stylemdSessionStore_1 = require("@/lib/store/stylemdSessionStore");
const helpers_1 = require("@/lib/stylemd-artifacts/helpers");
const stages_1 = require("@/lib/stylemd-artifacts/stages");
const styleguide_1 = require("@/lib/stylemd-artifacts/styleguide");
const persistStyleMdMongo_1 = require("@/lib/services/persistStyleMdMongo");
const provider_1 = require("@/lib/stylemd-artifacts/provider");
const types_1 = require("@/lib/stylemd-artifacts/types");
function runId() {
    return `stylemd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
function mergeConfig(config) {
    return {
        ...types_1.DEFAULT_STYLEMD_PIPELINE_CONFIG,
        ...config,
        viewport: {
            ...types_1.DEFAULT_STYLEMD_PIPELINE_CONFIG.viewport,
            ...(config?.viewport ?? {}),
        },
    };
}
function buildCuratedManifestFromComponents(runId, url, components) {
    const units = components.map((comp, idx) => ({
        unit_id: `unit_${idx + 1}`,
        type: "single",
        component_ids: [comp.componentId],
        study_label: comp.componentId,
        reason: `Extracted component ${idx + 1}`,
        components: [comp],
    }));
    return {
        run_id: runId,
        url,
        curated_at: (0, helpers_1.nowIso)(),
        source_manifest_path: "dedup",
        units,
        kept_component_ids: components.map((c) => c.componentId),
        deleted_component_ids: [],
    };
}
async function runSimplifiedStyleMdPipeline(url, provider = "kimi") {
    const id = runId();
    const runIdValue = id;
    const abortController = new AbortController();
    const signal = abortController.signal;
    const runtime = (0, provider_1.resolveStyleMdRuntimeConfig)(provider);
    // Register the run as pending in MongoDB immediately so polling can resolve
    // the runId before the pipeline finishes.
    try {
        await (0, persistStyleMdMongo_1.markStyleMdRunPendingInMongo)({
            url,
            runId: runIdValue,
            provider: runtime.provider,
            model: runtime.model,
        });
    }
    catch (err) {
        console.warn("[simplifiedPipeline] Failed to mark run pending in MongoDB:", err instanceof Error ? err.message : String(err));
    }
    const config = mergeConfig({});
    let state = (0, helpers_1.createInitialRunState)(runIdValue, url, runtime.provider, runtime.model);
    async function emitAndLog(event) {
        const fullEvent = (0, stylemdSessionStore_1.emitEvent)(event);
        await (0, artifacts_1.appendStyleMdLogLine)(runIdValue, fullEvent);
    }
    async function publishState() {
        const stateArtifact = await (0, artifacts_1.persistStyleMdState)(runIdValue, state);
        state = (0, helpers_1.updateRunState)(state, {
            artifacts: (0, helpers_1.mergeArtifact)(state.artifacts, stateArtifact),
        });
    }
    function registerArtifacts(artifacts) {
        let nextArtifacts = state.artifacts;
        for (const artifact of artifacts) {
            nextArtifacts = (0, helpers_1.mergeArtifact)(nextArtifacts, artifact);
        }
        state = (0, helpers_1.updateRunState)(state, {
            artifacts: nextArtifacts,
        });
    }
    async function runStage(stage, handler) {
        (0, helpers_1.assertNotAborted)(signal);
        const stageNames = {
            capture: { num: 1, emoji: "📸" },
            extract: { num: 2, emoji: "🔍" },
            dedup: { num: 3, emoji: "🎯" },
            styleguide: { num: 4, emoji: "✨" },
        };
        const stageInfo = stageNames[stage];
        console.log(`\n${stageInfo.emoji} [SIMPLE PIPELINE] Stage ${stageInfo.num}/4: ${stage.toUpperCase()}`);
        const startedAt = (0, helpers_1.nowIso)();
        const startedMs = Date.now();
        state = (0, helpers_1.updateStageState)(state, stage, {
            status: "running",
            startedAt,
            completedAt: undefined,
            durationMs: undefined,
            error: undefined,
        });
        await emitAndLog({
            type: "stylemd_stage_started",
            source: "system",
            runId: runIdValue,
            stage,
            startedAt,
        });
        await publishState();
        try {
            const output = await handler();
            const durationMs = Date.now() - startedMs;
            console.log(`✅ [SIMPLE PIPELINE] Stage ${stageInfo.num}/4 complete (${durationMs}ms)\n`);
            state = (0, helpers_1.updateStageState)(state, stage, {
                status: "completed",
                completedAt: (0, helpers_1.nowIso)(),
                durationMs,
                error: undefined,
            });
            await emitAndLog({
                type: "stylemd_stage_completed",
                source: "system",
                runId: runIdValue,
                stage,
                durationMs,
            });
            await publishState();
            return output;
        }
        catch (error) {
            const durationMs = Date.now() - startedMs;
            state = (0, helpers_1.updateStageState)(state, stage, {
                status: "failed",
                completedAt: (0, helpers_1.nowIso)(),
                durationMs,
                error: (0, helpers_1.errorToMessage)(error),
            });
            await emitAndLog({
                type: "stylemd_stage_failed",
                source: "system",
                runId: runIdValue,
                stage,
                error: (0, helpers_1.errorToMessage)(error),
            });
            await publishState();
            throw error;
        }
    }
    let browser = null;
    let context = null;
    let page = null;
    const closeBrowser = async () => {
        try {
            await page?.close();
        }
        catch {
            // Ignore
        }
        try {
            await context?.close();
        }
        catch {
            // Ignore
        }
        try {
            await browser?.close();
        }
        catch {
            // Ignore
        }
        page = null;
        context = null;
        browser = null;
    };
    const onAbort = () => {
        void closeBrowser();
    };
    signal.addEventListener("abort", onAbort, { once: true });
    await publishState();
    const eventsLogArtifact = await (0, artifacts_1.writeStyleMdText)(runIdValue, (0, node_path_1.join)("logs", "events.ndjson"), "", "text");
    registerArtifacts([eventsLogArtifact]);
    await publishState();
    await emitAndLog({
        type: "stylemd_run_started",
        source: "system",
        runId: runIdValue,
        url,
        provider: runtime.provider,
        model: runtime.model,
        startedAt: state.startedAt,
        stages: ["capture", "extract", "dedup", "styleguide"],
    });
    let fullScreenshotPath = "";
    try {
        browser = await playwright_1.chromium.launch({
            headless: true,
            args: ["--disable-blink-features=AutomationControlled"],
        });
        context = await browser.newContext({
            viewport: {
                width: config.viewport.width,
                height: config.viewport.height,
            },
            deviceScaleFactor: config.viewport.deviceScaleFactor,
            userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        });
        await context.addInitScript(() => {
            window.__name = (t, v) => t;
        });
        page = await context.newPage();
        await runStage("capture", async () => {
            (0, helpers_1.assertNotAborted)(signal);
            await page.goto(url, {
                waitUntil: "domcontentloaded",
                timeout: 90000,
            });
            console.log(`\n📸 [SIMPLE PIPELINE] Stage 1: CAPTURE - Taking screenshot at ${url}`);
            const capture = await (0, stages_1.runCaptureStage)({
                runId: runIdValue,
                page: page,
                signal,
            });
            fullScreenshotPath = capture.result.fullScreenshotPath;
            console.log(`✅ [SIMPLE PIPELINE] Stage 1 complete: captured ${capture.result.viewport.width}x${capture.result.viewport.height}px`);
            registerArtifacts(capture.artifacts);
            await publishState();
        });
        const extract = await runStage("extract", async () => {
            const output = await (0, stages_1.runExtractStage)({
                runId: runIdValue,
                page: page,
                config,
                signal,
            });
            registerArtifacts(output.artifacts);
            state = (0, helpers_1.updateRunState)(state, {
                metrics: {
                    ...state.metrics,
                    candidateCount: output.result.candidateCount,
                    extractedComponents: output.result.components.length,
                },
            });
            await publishState();
            return output.result;
        });
        await closeBrowser();
        const dedup = await runStage("dedup", async () => {
            const output = await (0, stages_1.runDedupStage)({
                runId: runIdValue,
                components: extract.components,
                threshold: config.dedupSsimThreshold,
                signal,
            });
            registerArtifacts(output.artifacts);
            state = (0, helpers_1.updateRunState)(state, {
                metrics: {
                    ...state.metrics,
                    dedupedComponents: output.result.keptComponents.length,
                    duplicatesDeleted: output.result.deletedComponentIds.length,
                },
            });
            await publishState();
            return output.result;
        });
        const curatedManifest = buildCuratedManifestFromComponents(runIdValue, url, dedup.keptComponents);
        const curatedManifestArtifact = await (0, artifacts_1.writeStyleMdJson)(runIdValue, "curated.json", curatedManifest);
        registerArtifacts([curatedManifestArtifact]);
        const curatedManifestPath = curatedManifestArtifact.path;
        let styleguideStageResult = null;
        try {
            styleguideStageResult = await runStage("styleguide", async () => {
                try {
                    (0, helpers_1.assertNotAborted)(signal);
                    browser = await playwright_1.chromium.launch({
                        headless: true,
                        args: ["--disable-blink-features=AutomationControlled"],
                    });
                    context = await browser.newContext({
                        viewport: {
                            width: config.viewport.width,
                            height: config.viewport.height,
                        },
                        deviceScaleFactor: config.viewport.deviceScaleFactor,
                        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                    });
                    await context.addInitScript(() => {
                        window.__name = (t, v) => t;
                    });
                    page = await context.newPage();
                }
                catch (error) {
                    const warning = `Browser relaunch failed for styleguide stage; continuing. Reason: ${(0, helpers_1.errorToMessage)(error)}`;
                    state = (0, helpers_1.updateRunState)(state, {
                        warnings: [...state.warnings, warning],
                    });
                    await emitAndLog({
                        type: "stylemd_action",
                        source: "system",
                        runId: runIdValue,
                        stage: "styleguide",
                        level: "warn",
                        message: warning,
                    });
                    await publishState();
                }
                const output = await (0, styleguide_1.runStyleguideStage)({
                    runId: runIdValue,
                    url,
                    curatedManifestPath,
                    curatedManifest,
                    signal,
                    runtime,
                });
                registerArtifacts(output.artifacts);
                await publishState();
                return output.result;
            });
        }
        catch (error) {
            if (error instanceof styleguide_1.StyleguideStageError) {
                const warning = error.warning;
                state = (0, helpers_1.updateRunState)(state, {
                    warnings: [...state.warnings, warning],
                });
                await emitAndLog({
                    type: "stylemd_action",
                    source: "system",
                    runId: runIdValue,
                    stage: "styleguide",
                    level: "warn",
                    message: warning,
                });
                await publishState();
            }
            else {
                throw error;
            }
        }
        state = (0, helpers_1.updateRunState)(state, {
            status: state.warnings.length > 0 ? "completed_with_warnings" : "completed",
            completedAt: (0, helpers_1.nowIso)(),
        });
        const styleMdPath = styleguideStageResult?.styleMdPath ?? (0, node_path_1.join)((0, artifacts_1.getStyleMdRunDir)(runIdValue), "style.md");
        let styleMdContent = "";
        try {
            styleMdContent = await (0, promises_1.readFile)(styleMdPath, "utf-8");
        }
        catch {
            styleMdContent = styleguideStageResult?.styleMarkdown ?? "";
        }
        let screenshotUrlPath = "";
        let screenshotBase64 = "";
        try {
            const screenshotPath = (0, node_path_1.join)((0, artifacts_1.getStyleMdRunDir)(runIdValue), "full_screenshot.png");
            screenshotUrlPath = `/styleguide-files/${runIdValue}/full_screenshot.png`;
            screenshotBase64 = await (0, fileToBase64_1.fileToBase64)(screenshotPath, "image/png");
            console.log(`[SIMPLE PIPELINE] Screenshot saved as base64 (size: ${screenshotBase64.length} bytes)`);
        }
        catch (err) {
            screenshotUrlPath = "";
            screenshotBase64 = "";
            console.warn(`[SIMPLE PIPELINE] Failed to convert screenshot to base64: ${err instanceof Error ? err.message : String(err)}`);
        }
        const summary = {
            runId: runIdValue,
            provider: runtime.provider,
            model: runtime.model,
            url,
            status: state.status,
            startedAt: state.startedAt,
            completedAt: state.completedAt,
            warnings: state.warnings,
            artifacts: state.artifacts,
            metrics: {
                ...state.metrics,
                dedupedComponents: dedup.keptComponents.length,
                duplicatesDeleted: dedup.deletedComponentIds.length,
                curatedUnits: curatedManifest.units.length,
                curatedComponents: curatedManifest.kept_component_ids.length,
                curationDeleted: 0,
            },
            showcase: {
                available: false,
                canonicalUrl: "",
                latestUrl: "",
            },
        };
        const summaryArtifact = await (0, artifacts_1.persistStyleMdSummary)(runIdValue, summary);
        state = (0, helpers_1.updateRunState)(state, {
            artifacts: (0, helpers_1.mergeArtifact)(state.artifacts, summaryArtifact),
        });
        await publishState();
        // Persist to MongoDB BEFORE emitting the completed event so the frontend
        // can use data.styleMd from the SSE payload and the first DB poll already
        // finds a completed record.
        try {
            await (0, persistStyleMdMongo_1.persistStyleMdAfterGeneration)({
                url,
                runId: runIdValue,
                provider: runtime.provider,
                model: runtime.model,
                styleMd: styleMdContent,
                screenshotUrl: screenshotUrlPath,
                screenshot: screenshotBase64,
                runStatus: summary.status,
            });
        }
        catch (dbErr) {
            console.warn(`[simplifiedPipeline] MongoDB persist failed: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`);
        }
        await emitAndLog({
            type: "stylemd_run_completed",
            source: "system",
            runId: runIdValue,
            provider: runtime.provider,
            model: runtime.model,
            status: summary.status,
            completedAt: summary.completedAt,
            styleMd: styleMdContent,
            warnings: summary.warnings,
            showcase: {
                available: false,
                canonicalUrl: "",
                latestUrl: "",
            },
        });
        return {
            runId: runIdValue,
            styleMd: styleMdContent,
            screenshotUrl: screenshotUrlPath,
            screenshot: screenshotBase64,
            model: runtime.model,
        };
    }
    catch (error) {
        const canceled = signal.aborted || (0, helpers_1.isAbortError)(error);
        state = (0, helpers_1.updateRunState)(state, {
            status: canceled ? "canceled" : "failed",
            completedAt: (0, helpers_1.nowIso)(),
            error: (0, helpers_1.errorToMessage)(error),
        });
        await (0, artifacts_1.persistStyleMdSummary)(runIdValue, {
            runId: runIdValue,
            provider: runtime.provider,
            model: runtime.model,
            url,
            status: state.status,
            startedAt: state.startedAt,
            completedAt: state.completedAt,
            error: state.error,
            warnings: state.warnings,
            artifacts: state.artifacts,
            metrics: state.metrics,
            showcase: {
                available: false,
                canonicalUrl: "",
                latestUrl: "",
            },
        });
        await publishState();
        throw error;
    }
    finally {
        signal.removeEventListener("abort", onAbort);
        await closeBrowser();
    }
}
