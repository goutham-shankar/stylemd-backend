"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runSimplifiedStyleMdPipeline = runSimplifiedStyleMdPipeline;
const node_path_1 = require("node:path");
const playwright_1 = require("playwright");
const sharp_1 = __importDefault(require("sharp"));
const mongoose_1 = __importDefault(require("mongoose"));
const mongodb_1 = require("../../lib/mongodb");
const scraper_1 = require("../../backend/src/services/scraper");
const StyleMdRun_1 = require("../../backend/src/models/StyleMdRun");
const ScrapedData_1 = require("../../backend/src/models/ScrapedData");
const pageUrlCanonical_1 = require("../../lib/services/pageUrlCanonical");
const artifacts_1 = require("../../lib/stylemd-artifacts/artifacts");
const stylemdSessionStore_1 = require("../../lib/store/stylemdSessionStore");
const helpers_1 = require("../../lib/stylemd-artifacts/helpers");
const stages_1 = require("../../lib/stylemd-artifacts/stages");
const curation_1 = require("../../lib/stylemd-artifacts/curation");
const styleguide_1 = require("../../lib/stylemd-artifacts/styleguide");
const persistStyleMdMongo_1 = require("../../lib/services/persistStyleMdMongo");
const kimiUsage_1 = require("../../lib/services/kimiUsage");
const provider_1 = require("../../lib/stylemd-artifacts/provider");
const types_1 = require("../../lib/stylemd-artifacts/types");
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
async function runSimplifiedStyleMdPipeline(url, provider = "kimi", forcedRunId) {
    // Step 3: Auto-recover in pipeline
    await (0, mongodb_1.connectDB)();
    if (mongoose_1.default.connection.readyState !== 1) {
        throw new Error("Mongo not connected after retry");
    }
    const id = forcedRunId || runId();
    const runIdValue = id;
    const abortController = new AbortController();
    const signal = abortController.signal;
    const runtime = (0, provider_1.resolveStyleMdRuntimeConfig)(provider);
    // Step 1 & 2: Collection-based Keep-Alive Ping at 10s frequency
    const keepAliveInterval = setInterval(async () => {
        await (0, mongodb_1.mongoKeepAlive)();
    }, 10000);
    // 🔴 Mark run pending so the DB record exists for the screenshot
    try {
        await (0, persistStyleMdMongo_1.markStyleMdRunPendingInMongo)({
            url,
            runId: runIdValue,
            provider: runtime.provider,
            model: runtime.model,
        });
    }
    catch (e) {
        console.warn("[PIPELINE] early pending persist failed, continuing under unstable network", e);
    }
    // 🔴 STEP 1: MOVE SCRAPE TO START (In-memory only for now)
    (0, helpers_1.runIdLog)(runIdValue, `Early scraping ${url}...`);
    const canonUrl = (0, pageUrlCanonical_1.canonicalPageUrl)(url);
    const scraped = await (0, scraper_1.scrape)(canonUrl);
    if (scraped) {
        (0, helpers_1.runIdLog)(runIdValue, `[DEBUG] Scrape result: title="${scraped.title}", htmlLength=${scraped.rawHtml?.length ?? 0}, textLength=${scraped.contentText?.length ?? 0}, imagesCount=${scraped.images?.length ?? 0}`);
    }
    else {
        (0, helpers_1.runIdLog)(runIdValue, `[DEBUG] Scrape FAILED (returned null) for ${url}`, "warn");
    }
    // 🔴 STEP 2: OPTIONAL/NON-BLOCKING SCRAPED DATA PERSIST (slim — storage v2)
    // Only lightweight metadata; HTML/markdown/screenshots are uploaded to R2
    // by the worker after this pipeline completes.
    if (scraped) {
        (0, mongodb_1.safeWrite)(() => ScrapedData_1.ScrapedData.updateOne({ url: canonUrl }, {
            $set: {
                url: canonUrl,
                title: scraped.title ?? null,
                description: scraped.description ?? null,
                h1: scraped.h1 ?? null,
                canonical: scraped.canonical ?? null,
                contentText: scraped.contentText ?? null,
                runId: runIdValue,
                status: "running",
                updatedAt: new Date(),
            },
            $setOnInsert: { createdAt: new Date() },
        }, { upsert: true })).catch((e) => {
            (0, helpers_1.runIdLog)(runIdValue, `[FALLBACK_TRIGGERED] ScrapedData optional persist failed: ${e instanceof Error ? e.message : String(e)}`, "warn");
        });
    }
    const config = mergeConfig({});
    let state = (0, helpers_1.createInitialRunState)(runIdValue, url, runtime.provider, runtime.model);
    let aggregateTokenUsage = (0, kimiUsage_1.createEmptyKimiTokenUsage)();
    // Use Kimi for curation and generation stages to reduce costs and use high-reasoning models
    const kimiRuntime = (0, provider_1.resolveStyleMdRuntimeConfig)("kimi");
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
            curate: { num: 4, emoji: "📋" },
            styleguide: { num: 5, emoji: "✨" },
            showcase: { num: 6, emoji: "🎪" },
        };
        const stageInfo = stageNames[stage] || { num: 0, emoji: "⚙️" };
        console.log(`\n${stageInfo.emoji} [PIPELINE] Stage ${stageInfo.num}/6: ${stage.toUpperCase()}`);
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
        await emitAndLog({
            type: "stylemd_action",
            source: "system",
            runId: runIdValue,
            stage,
            level: "info",
            message: `${stage} stage started.`,
        });
        await publishState();
        try {
            const output = await handler();
            const durationMs = Date.now() - startedMs;
            console.log(`✅ [PIPELINE] Stage ${stageInfo.num}/6 complete (${durationMs}ms)\n`);
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
            await emitAndLog({
                type: "stylemd_action",
                source: "system",
                runId: runIdValue,
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
                runId: runIdValue,
                stage,
                error: (0, helpers_1.errorToMessage)(error),
            });
            await emitAndLog({
                type: "stylemd_action",
                source: "system",
                runId: runIdValue,
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
        stages: ["capture", "extract", "dedup", "curate", "styleguide", "showcase"],
    });
    let fullScreenshotPath = "";
    let screenshotBase64Var = "";
    let extractionMetadataVar = null;
    try {
        browser = await playwright_1.chromium.launch((0, helpers_1.getPlaywrightLaunchOptions)());
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
            console.log(`\n📸 [STYLEMD] Stage 1/6: CAPTURE - Taking screenshot at ${url}`);
            const capture = await (0, stages_1.runCaptureStage)({
                runId: runIdValue,
                page: page,
                signal,
            });
            fullScreenshotPath = capture.result.fullScreenshotPath;
            registerArtifacts(capture.artifacts);
            await publishState();
            // --- Save screenshot to MongoDB immediately after capture ---
            try {
                const buffer = await page.screenshot({
                    type: "jpeg",
                    quality: 60,
                    fullPage: true,
                });
                const compressedBuffer = await (0, sharp_1.default)(buffer)
                    .resize({ width: 1000, withoutEnlargement: true })
                    .jpeg({ quality: 60 })
                    .toBuffer();
                if (compressedBuffer.length <= 1500000) {
                    // Keep base64 in memory for the worker to upload to R2; no longer
                    // persisted to Mongo (storage v2 — screenshots live in R2 only).
                    screenshotBase64Var = `data:image/jpeg;base64,${compressedBuffer.toString("base64")}`;
                    (0, helpers_1.runIdLog)(runIdValue, "[SCREENSHOT] Captured (will be uploaded to R2 by worker)");
                }
            }
            catch (ssErr) {
                console.warn(`[SCREENSHOT] ⚠️ Failed to capture screenshot: ${ssErr instanceof Error ? ssErr.message : String(ssErr)}`);
            }
        });
        const extract = await runStage("extract", async () => {
            const output = await (0, stages_1.runExtractStage)({
                runId: runIdValue,
                page: page,
                config,
                signal,
            });
            registerArtifacts(output.artifacts);
            // Extract stage is pure DOM analysis — no Kimi tokens to accumulate.
            state = (0, helpers_1.updateRunState)(state, {
                metrics: {
                    ...state.metrics,
                    candidateCount: output.result.candidateCount,
                    extractedComponents: output.result.components.length,
                },
            });
            extractionMetadataVar = {
                scannedElements: output.result.designTokenManifest?.metrics.totalElementsScanned,
                durationMs: output.result.designTokenManifest?.metrics.extractionDurationMs,
                confidenceScore: output.result.designTokenManifest?.metrics.confidenceScore,
                primaryColors: output.result.designTokenManifest?.palette.primary,
                typographyFamilies: output.result.designTokenManifest?.typography.display,
                sectionCount: output.result.semanticStructure?.sections.length,
                // Full manifests for frontend reconstruction
                designTokenManifest: output.result.designTokenManifest,
                semanticStructure: output.result.semanticStructure,
            };
            await publishState();
            await (0, mongodb_1.mongoKeepAlive)();
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
            await (0, mongodb_1.mongoKeepAlive)();
            return output.result;
        });
        const curate = await runStage("curate", async () => {
            const output = await (0, curation_1.runCurateStage)({
                runId: runIdValue,
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
            await (0, mongodb_1.mongoKeepAlive)();
            return output.result;
        });
        let hasStyleguideWarning = false;
        let responsiveHoverEvidencePath;
        let styleguideStageResult = null;
        try {
            styleguideStageResult = await runStage("styleguide", async () => {
                try {
                    (0, helpers_1.assertNotAborted)(signal);
                    browser = await playwright_1.chromium.launch((0, helpers_1.getPlaywrightLaunchOptions)());
                    context = await browser.newContext({
                        viewport: {
                            width: config.viewport.width,
                            height: config.viewport.height,
                        },
                        deviceScaleFactor: config.viewport.deviceScaleFactor,
                        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                    });
                    page = await context.newPage();
                    const enrichment = await (0, stages_1.runCuratedResponsiveHoverEvidenceStage)({
                        runId: runIdValue,
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
                    const warning = `Responsive/hover enrichment failed; continuing. Reason: ${(0, helpers_1.errorToMessage)(error)}`;
                    state = (0, helpers_1.updateRunState)(state, {
                        warnings: [...state.warnings, warning],
                    });
                    await publishState();
                }
                finally {
                    await closeBrowser();
                }
                const output = await (0, styleguide_1.runStyleguideStage)({
                    runId: runIdValue,
                    url,
                    curatedManifestPath: curate.curatedManifestPath,
                    curatedManifest: curate.curatedManifest,
                    responsiveHoverEvidencePath,
                    signal,
                    runtime: kimiRuntime,
                });
                registerArtifacts(output.artifacts);
                aggregateTokenUsage = (0, kimiUsage_1.accumulateKimiTokenUsage)(aggregateTokenUsage, output.result.query);
                await publishState();
                await (0, mongodb_1.mongoKeepAlive)();
                return output.result;
            });
        }
        catch (error) {
            if (error instanceof styleguide_1.StyleguideStageError) {
                hasStyleguideWarning = true;
                if (error.query) {
                    aggregateTokenUsage = (0, kimiUsage_1.accumulateKimiTokenUsage)(aggregateTokenUsage, error.query);
                }
                state = (0, helpers_1.updateRunState)(state, {
                    warnings: [...state.warnings, error.warning],
                });
                await publishState();
            }
            else {
                throw error;
            }
        }
        const showcaseStageResult = await runStage("showcase", async () => {
            const output = await (0, styleguide_1.runShowcaseStage)({
                runId: runIdValue,
                url,
                curatedManifestPath: curate.curatedManifestPath,
                curatedManifest: curate.curatedManifest,
                responsiveHoverEvidencePath,
                styleMdPath: styleguideStageResult?.styleMdPath ?? (0, node_path_1.join)((0, artifacts_1.getStyleMdRunDir)(runIdValue), "style.md"),
                styleMarkdown: styleguideStageResult?.styleMarkdown,
                evidenceAgentPath: styleguideStageResult?.evidenceAgentPath ?? (0, node_path_1.join)((0, artifacts_1.getStyleMdRunDir)(runIdValue), "styleguide", "evidence.agent.json"),
                typographyInventoryPath: styleguideStageResult?.typographyInventoryPath,
                typographyInventory: styleguideStageResult?.typographyInventory,
                requiredTypographyFamilies: styleguideStageResult?.requiredTypographyFamilies,
                fontsManifestPath: extract.fontsManifestPath,
                fontsLocalCssPath: extract.fontsLocalCssPath,
                signal,
                runtime: kimiRuntime,
            });
            registerArtifacts(output.artifacts);
            aggregateTokenUsage = (0, kimiUsage_1.accumulateKimiTokenUsage)(aggregateTokenUsage, output.result.query);
            state = (0, helpers_1.updateRunState)(state, {
                showcase: output.result.showcase,
            });
            await publishState();
            await (0, mongodb_1.mongoKeepAlive)();
            return output.result;
        });
        if (showcaseStageResult.warning) {
            state = (0, helpers_1.updateRunState)(state, {
                warnings: [...state.warnings, showcaseStageResult.warning],
            });
            await publishState();
        }
        state = (0, helpers_1.updateRunState)(state, {
            status: hasStyleguideWarning || state.warnings.length > 0 ? "completed_with_warnings" : "completed",
            completedAt: (0, helpers_1.nowIso)(),
        });
        const styleMdContent = styleguideStageResult?.styleMarkdown ?? "";
        // Extract structured design tokens from the stylemd-json block (extract once, persist twice)
        let designTokens = null;
        try {
            const jsonMatch = styleMdContent.match(/```(?:stylemd-json|json)\s*\n([\s\S]*?)```/);
            if (jsonMatch?.[1]) {
                designTokens = JSON.parse(jsonMatch[1]);
                (0, helpers_1.runIdLog)(runIdValue, `[DESIGN_TOKENS] Extracted designTokens from stylemd-json block.`);
            }
        }
        catch (parseErr) {
            (0, helpers_1.runIdLog)(runIdValue, `[DESIGN_TOKENS] Failed to parse stylemd-json block: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`, "warn");
        }
        const summary = {
            runId: runIdValue,
            provider: runtime.provider,
            model: runtime.model,
            url,
            status: state.status,
            startedAt: state.startedAt,
            completedAt: state.completedAt,
            warnings: [
                ...state.warnings,
                `Used ${kimiRuntime.provider} for curation and generation stages.`,
            ],
            artifacts: state.artifacts,
            metrics: state.metrics,
            tokenUsage: aggregateTokenUsage,
            costEstimate: (0, kimiUsage_1.estimateKimiCost)(runtime.model, aggregateTokenUsage),
            showcase: state.showcase,
        };
        const summaryArtifact = await (0, artifacts_1.persistStyleMdSummary)(runIdValue, summary);
        state = (0, helpers_1.updateRunState)(state, {
            artifacts: (0, helpers_1.mergeArtifact)(state.artifacts, summaryArtifact),
        });
        await publishState();
        if (mongoose_1.default.connection.readyState !== 1) {
            await (0, mongodb_1.connectDB)();
        }
        try {
            await (0, persistStyleMdMongo_1.persistStyleMdAfterGeneration)({
                url,
                runId: runIdValue,
                provider: runtime.provider,
                model: runtime.model,
                styleMd: styleMdContent,
                designTokens,
                screenshot: screenshotBase64Var,
                runStatus: summary.status,
                tokenUsage: summary.tokenUsage,
                costEstimate: summary.costEstimate,
                brandAssets: scraped?.brandAssets,
                extractionMetadata: extractionMetadataVar,
                title: scraped?.title,
                description: scraped?.description,
                h1: scraped?.h1,
                canonical: scraped?.canonical,
            });
        }
        catch (dbErr) {
            console.error(`Final persist failed: ${(0, helpers_1.errorToMessage)(dbErr)}`);
            throw dbErr;
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
            showcase: summary.showcase,
        });
        return {
            runId: runIdValue,
            styleMd: styleMdContent,
            screenshot: screenshotBase64Var,
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
            tokenUsage: aggregateTokenUsage,
            costEstimate: (0, kimiUsage_1.estimateKimiCost)(runtime.model, aggregateTokenUsage),
            showcase: {
                available: false,
                canonicalUrl: "",
                latestUrl: "",
            },
        });
        await publishState();
        // --- PERSIST FAILURE TO MONGODB ---
        try {
            const finalStatus = canceled ? "canceled" : "failed";
            console.log(`[PIPELINE] marking run ${finalStatus}: ${runIdValue}`);
            await (0, mongodb_1.connectDB)();
            await (0, mongodb_1.safeWrite)(() => StyleMdRun_1.StyleMdRun.updateOne({ runId: runIdValue }, {
                $set: {
                    status: finalStatus,
                    updatedAt: new Date()
                }
            }));
        }
        catch (dbErr) {
            console.warn(`[PIPELINE] Failed to persist failure status to MongoDB: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`);
        }
        throw error;
    }
    finally {
        clearInterval(keepAliveInterval);
        signal.removeEventListener("abort", onAbort);
        await closeBrowser();
    }
}
