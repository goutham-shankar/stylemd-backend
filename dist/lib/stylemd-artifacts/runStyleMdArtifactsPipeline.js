"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runStyleMdArtifactsPipeline = runStyleMdArtifactsPipeline;
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const playwright_1 = require("playwright");
const artifacts_1 = require("@/lib/stylemd-artifacts/artifacts");
const stylemdSessionStore_1 = require("@/lib/store/stylemdSessionStore");
const helpers_1 = require("@/lib/stylemd-artifacts/helpers");
const stages_1 = require("@/lib/stylemd-artifacts/stages");
const curation_1 = require("@/lib/stylemd-artifacts/curation");
const styleguide_1 = require("@/lib/stylemd-artifacts/styleguide");
const provider_1 = require("@/lib/stylemd-artifacts/provider");
const types_1 = require("@/lib/stylemd-artifacts/types");
const fileToBase64_1 = require("@/lib/utils/fileToBase64");
const persistStyleMdMongo_1 = require("@/lib/services/persistStyleMdMongo");
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
async function runStyleMdArtifactsPipeline(runId, url, abortController, options = {}) {
    const signal = abortController.signal;
    const config = mergeConfig(options.config);
    const runtime = options.runtime ?? (0, provider_1.resolveStyleMdRuntimeConfig)(options.provider ?? "claude");
    try {
        await (0, persistStyleMdMongo_1.markStyleMdRunPendingInMongo)({
            url,
            runId,
            provider: runtime.provider,
            model: runtime.model,
        });
    }
    catch (err) {
        console.warn("[runStyleMdArtifactsPipeline] Failed to mark run pending in MongoDB:", err instanceof Error ? err.message : String(err));
    }
    // Use Kimi for curation and generation stages (curate, styleguide) to reduce costs
    const kimiRuntime = (0, provider_1.resolveStyleMdRuntimeConfig)("kimi");
    let state = (0, helpers_1.createInitialRunState)(runId, url, runtime.provider, runtime.model);
    async function emitAndLog(event) {
        const fullEvent = (0, stylemdSessionStore_1.emitEvent)(event);
        await (0, artifacts_1.appendStyleMdLogLine)(runId, fullEvent);
    }
    async function publishState() {
        const stateArtifact = await (0, artifacts_1.persistStyleMdState)(runId, state);
        state = (0, helpers_1.updateRunState)(state, {
            artifacts: (0, helpers_1.mergeArtifact)(state.artifacts, stateArtifact),
        });
        if (options.onStateChange) {
            await options.onStateChange(state);
        }
    }
    function registerArtifacts(artifacts) {
        let nextArtifacts = state.artifacts;
        for (const artifact of artifacts) {
            nextArtifacts = (0, helpers_1.mergeArtifact)(nextArtifacts, artifact);
            void emitAndLog({
                type: "stylemd_artifact_ready",
                source: "system",
                runId,
                artifact,
            });
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
            curate: { num: 4, emoji: "📋" },
            styleguide: { num: 5, emoji: "✨" },
        };
        const stageInfo = stageNames[stage] || { num: 0, emoji: "⚙️" };
        console.log(`\n${stageInfo.emoji} [PIPELINE] Stage ${stageInfo.num}/5: ${stage.toUpperCase()}`);
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
            runId,
            stage,
            startedAt,
        });
        await emitAndLog({
            type: "stylemd_action",
            source: "system",
            runId,
            stage,
            level: "info",
            message: `${stage} stage started.`,
        });
        await publishState();
        try {
            const output = await handler();
            const durationMs = Date.now() - startedMs;
            console.log(`✅ [PIPELINE] Stage ${stageInfo.num}/5 complete (${durationMs}ms)\n`);
            state = (0, helpers_1.updateStageState)(state, stage, {
                status: "completed",
                completedAt: (0, helpers_1.nowIso)(),
                durationMs,
                error: undefined,
            });
            await emitAndLog({
                type: "stylemd_stage_completed",
                source: "system",
                runId,
                stage,
                durationMs,
            });
            await emitAndLog({
                type: "stylemd_action",
                source: "system",
                runId,
                stage,
                level: "info",
                message: `${stage} stage completed.`,
                detail: { duration_ms: durationMs },
            });
            await publishState();
            return output;
        }
        catch (error) {
            const durationMs = Date.now() - startedMs;
            const stageArtifacts = error &&
                typeof error === "object" &&
                "artifacts" in error &&
                Array.isArray(error.artifacts)
                ? (error.artifacts)
                : [];
            if (stageArtifacts.length > 0) {
                registerArtifacts(stageArtifacts);
            }
            state = (0, helpers_1.updateStageState)(state, stage, {
                status: "failed",
                completedAt: (0, helpers_1.nowIso)(),
                durationMs,
                error: (0, helpers_1.errorToMessage)(error),
            });
            await emitAndLog({
                type: "stylemd_stage_failed",
                source: "system",
                runId,
                stage,
                error: (0, helpers_1.errorToMessage)(error),
            });
            await emitAndLog({
                type: "stylemd_action",
                source: "system",
                runId,
                stage,
                level: "error",
                message: `${stage} stage failed.`,
                detail: {
                    duration_ms: durationMs,
                    error: (0, helpers_1.errorToMessage)(error),
                },
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
            // Ignore close failures.
        }
        try {
            await context?.close();
        }
        catch {
            // Ignore close failures.
        }
        try {
            await browser?.close();
        }
        catch {
            // Ignore close failures.
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
    const eventsLogArtifact = await (0, artifacts_1.writeStyleMdText)(runId, (0, node_path_1.join)("logs", "events.ndjson"), "", "text");
    registerArtifacts([eventsLogArtifact]);
    await publishState();
    await emitAndLog({
        type: "stylemd_run_started",
        source: "system",
        runId,
        url,
        provider: runtime.provider,
        model: runtime.model,
        startedAt: state.startedAt,
        stages: [...types_1.STYLEMD_PIPELINE_STAGES],
    });
    await emitAndLog({
        type: "stylemd_action",
        source: "system",
        runId,
        level: "info",
        message: "StyleMD run started.",
        detail: {
            url,
        },
    });
    try {
        browser = await playwright_1.chromium.launch({ headless: true });
        context = await browser.newContext({
            viewport: {
                width: config.viewport.width,
                height: config.viewport.height,
            },
            deviceScaleFactor: config.viewport.deviceScaleFactor,
        });
        await context.addInitScript(() => {
            window.__name = (t, v) => t;
        });
        page = await context.newPage();
        await runStage("capture", async () => {
            (0, helpers_1.assertNotAborted)(signal);
            await page.goto(url, {
                waitUntil: "domcontentloaded",
                timeout: 45000,
            });
            console.log(`\n📸 [PIPELINE] Stage 1: CAPTURE - Taking screenshot at ${url}`);
            const capture = await (0, stages_1.runCaptureStage)({
                runId,
                page: page,
                signal,
            });
            console.log(`✅ [PIPELINE] Stage 1 complete: captured ${capture.result.viewport.width}x${capture.result.viewport.height}px`);
            registerArtifacts(capture.artifacts);
            await publishState();
        });
        const extract = await runStage("extract", async () => {
            const output = await (0, stages_1.runExtractStage)({
                runId,
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
                runId,
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
        const curate = await runStage("curate", async () => {
            const output = await (0, curation_1.runCurateStage)({
                runId,
                url,
                dedupAgentManifestPath: dedup.dedupAgentManifestPath,
                components: dedup.keptComponents,
                signal,
                runtime: kimiRuntime,
            });
            registerArtifacts(output.artifacts);
            state = (0, helpers_1.updateRunState)(state, {
                metrics: {
                    ...state.metrics,
                    curatedUnits: output.result.curatedManifest.units.length,
                    curatedComponents: output.result.keptComponentIds.length,
                    curationDeleted: output.result.deletedComponentIds.length,
                },
            });
            await publishState();
            return output.result;
        });
        let hasStyleguideWarning = false;
        let responsiveHoverEvidencePath;
        let styleguideStageResult = null;
        try {
            styleguideStageResult = await runStage("styleguide", async () => {
                try {
                    (0, helpers_1.assertNotAborted)(signal);
                    browser = await playwright_1.chromium.launch({ headless: true });
                    context = await browser.newContext({
                        viewport: {
                            width: config.viewport.width,
                            height: config.viewport.height,
                        },
                        deviceScaleFactor: config.viewport.deviceScaleFactor,
                    });
                    await context.addInitScript(() => {
                        window.__name = (t, v) => t;
                    });
                    page = await context.newPage();
                    const enrichment = await (0, stages_1.runCuratedResponsiveHoverEvidenceStage)({
                        runId,
                        url,
                        page: page,
                        curatedManifest: curate.curatedManifest,
                        signal,
                    });
                    responsiveHoverEvidencePath = enrichment.result.evidencePath;
                    registerArtifacts(enrichment.artifacts);
                    await publishState();
                }
                catch (error) {
                    const warning = `Responsive/hover enrichment failed; continuing with available curated evidence. Reason: ${(0, helpers_1.errorToMessage)(error)}`;
                    state = (0, helpers_1.updateRunState)(state, {
                        warnings: [...state.warnings, warning],
                    });
                    await emitAndLog({
                        type: "stylemd_action",
                        source: "system",
                        runId,
                        stage: "styleguide",
                        level: "warn",
                        message: warning,
                    });
                    await publishState();
                }
                finally {
                    await closeBrowser();
                }
                const output = await (0, styleguide_1.runStyleguideStage)({
                    runId,
                    url,
                    curatedManifestPath: curate.curatedManifestPath,
                    curatedManifest: curate.curatedManifest,
                    responsiveHoverEvidencePath,
                    signal,
                    runtime: kimiRuntime,
                });
                registerArtifacts(output.artifacts);
                await publishState();
                return output.result;
            });
        }
        catch (error) {
            if (error instanceof styleguide_1.StyleguideStageError) {
                hasStyleguideWarning = true;
                const warning = error.warning;
                state = (0, helpers_1.updateRunState)(state, {
                    warnings: [...state.warnings, warning],
                });
                await emitAndLog({
                    type: "stylemd_action",
                    source: "system",
                    runId,
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
            status: hasStyleguideWarning || state.warnings.length > 0 ? "completed_with_warnings" : "completed",
            completedAt: (0, helpers_1.nowIso)(),
        });
        const summary = {
            runId,
            provider: runtime.provider,
            model: runtime.model,
            url,
            status: state.status,
            startedAt: state.startedAt,
            completedAt: state.completedAt,
            warnings: [
                ...state.warnings,
                `Used ${kimiRuntime.provider} for curation and generation stages (curate, styleguide).`,
            ],
            artifacts: state.artifacts,
            metrics: {
                ...state.metrics,
                dedupedComponents: dedup.keptComponents.length,
                duplicatesDeleted: dedup.deletedComponentIds.length,
                curatedUnits: curate.curatedManifest.units.length,
                curatedComponents: curate.keptComponentIds.length,
                curationDeleted: curate.deletedComponentIds.length,
            },
            showcase: state.showcase,
        };
        const summaryArtifact = await (0, artifacts_1.persistStyleMdSummary)(runId, summary);
        state = (0, helpers_1.updateRunState)(state, {
            artifacts: (0, helpers_1.mergeArtifact)(state.artifacts, summaryArtifact),
        });
        await publishState();
        // Read styleMd and persist to DB BEFORE emitting the completed event so the
        // frontend can use data.styleMd from the SSE payload and so that the first
        // DB poll after the event already finds a completed record.
        let styleMdContent = "";
        try {
            const styleMdPath = styleguideStageResult?.styleMdPath ?? (0, node_path_1.join)((0, artifacts_1.getStyleMdRunDir)(runId), "style.md");
            try {
                styleMdContent = await (0, promises_1.readFile)(styleMdPath, "utf-8");
            }
            catch {
                styleMdContent = styleguideStageResult?.styleMarkdown ?? "";
            }
            let screenshotUrlPath = `/styleguide-files/${runId}/full_screenshot.png`;
            let screenshotBase64 = "";
            try {
                screenshotBase64 = await (0, fileToBase64_1.fileToBase64)((0, node_path_1.join)((0, artifacts_1.getStyleMdRunDir)(runId), "full_screenshot.png"), "image/png");
            }
            catch {
                screenshotUrlPath = "";
                screenshotBase64 = "";
            }
            await (0, persistStyleMdMongo_1.persistStyleMdAfterGeneration)({
                url,
                runId,
                provider: runtime.provider,
                model: runtime.model,
                styleMd: styleMdContent,
                screenshotUrl: screenshotUrlPath,
                screenshot: screenshotBase64,
                runStatus: summary.status,
            });
        }
        catch (dbErr) {
            console.warn(`[runStyleMdArtifactsPipeline] MongoDB persist failed: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`);
        }
        await emitAndLog({
            type: "stylemd_run_completed",
            source: "system",
            runId,
            provider: runtime.provider,
            model: runtime.model,
            status: summary.status,
            completedAt: summary.completedAt,
            styleMd: styleMdContent,
            warnings: summary.warnings,
            showcase: {
                available: summary.showcase.available,
                canonicalUrl: summary.showcase.canonicalUrl,
                latestUrl: summary.showcase.latestUrl,
            },
        });
        return {
            ...summary,
            artifacts: state.artifacts,
        };
    }
    catch (error) {
        const canceled = signal.aborted || (0, helpers_1.isAbortError)(error);
        state = (0, helpers_1.updateRunState)(state, {
            status: canceled ? "canceled" : "failed",
            completedAt: (0, helpers_1.nowIso)(),
            error: (0, helpers_1.errorToMessage)(error),
        });
        const summary = {
            runId,
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
            showcase: state.showcase,
        };
        await (0, artifacts_1.persistStyleMdSummary)(runId, summary);
        await publishState();
        await emitAndLog({
            type: "stylemd_run_completed",
            source: "system",
            runId,
            provider: runtime.provider,
            model: runtime.model,
            status: summary.status,
            completedAt: summary.completedAt,
            error: summary.error,
            warnings: summary.warnings,
            showcase: {
                available: summary.showcase.available,
                canonicalUrl: summary.showcase.canonicalUrl,
                latestUrl: summary.showcase.latestUrl,
            },
        });
        try {
            await (0, persistStyleMdMongo_1.persistStyleMdAfterGeneration)({
                url,
                runId,
                provider: runtime.provider,
                model: runtime.model,
                styleMd: "",
                screenshotUrl: "",
                screenshot: "",
                runStatus: summary.status,
            });
        }
        catch (dbErr) {
            console.warn(`[runStyleMdArtifactsPipeline] MongoDB persist (terminal state) failed: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`);
        }
        return summary;
    }
    finally {
        signal.removeEventListener("abort", onAbort);
        await closeBrowser();
    }
}
