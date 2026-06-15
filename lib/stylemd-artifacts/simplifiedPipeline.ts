import { join } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import mongoose from "mongoose";
import { connectDB, safeWrite, mongoKeepAlive } from "@/lib/mongodb";
import { scrape } from "@/backend/src/services/scraper";
import { StyleMdRun } from "@/backend/src/models/StyleMdRun";
import { ScrapedData } from "@/backend/src/models/ScrapedData";
import { canonicalPageUrl, pageUrlVariantsForLookup } from "@/lib/services/pageUrlCanonical";
import {
  appendStyleMdLogLine,
  getStyleMdRunDir,
  persistStyleMdState,
  persistStyleMdSummary,
  writeStyleMdJson,
  writeStyleMdText,
} from "@/lib/stylemd-artifacts/artifacts";
import { emitEvent } from "@/lib/store/stylemdSessionStore";
import {
  assertNotAborted,
  createInitialRunState,
  errorToMessage,
  getPlaywrightLaunchOptions,
  isAbortError,
  mergeArtifact,
  nowIso,
  runIdLog,
  updateRunState,
  updateStageState,
} from "@/lib/stylemd-artifacts/helpers";
import {
  runCaptureStage,
  runCuratedResponsiveHoverEvidenceStage,
  runDedupStage,
  runExtractStage,
} from "@/lib/stylemd-artifacts/stages";
import { runCurateStage } from "@/lib/stylemd-artifacts/curation";
import { runShowcaseStage, runStyleguideStage, StyleguideStageError } from "@/lib/stylemd-artifacts/styleguide";
import { markStyleMdRunPendingInMongo, persistStyleMdAfterGeneration } from "@/lib/services/persistStyleMdMongo";
import { accumulateKimiTokenUsage, createEmptyKimiTokenUsage, estimateKimiCost } from "@/lib/services/kimiUsage";
import {
  resolveStyleMdRuntimeConfig,
  type StyleMdRuntimeConfig,
} from "@/lib/stylemd-artifacts/provider";
import {
  DEFAULT_STYLEMD_PIPELINE_CONFIG,
  type StyleMdArtifactRecord,
  type StyleMdComponentEntry,
  type StyleMdCuratedManifest,
  type StyleMdPipelineConfig,
  type StyleMdPipelineStageName,
  type StyleMdProvider,
  type StyleMdRunState,
  type StyleMdRunSummary,
} from "@/lib/stylemd-artifacts/types";
import type { PlaygroundEvent } from "@/lib/types/stylemdEvents";

type StyleMdPipelineEventPayload = {
  type: PlaygroundEvent["type"];
  source: PlaygroundEvent["source"];
  [key: string]: unknown;
};

function runId(): string {
  return `stylemd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function mergeConfig(config?: Partial<StyleMdPipelineConfig>): StyleMdPipelineConfig {
  return {
    ...DEFAULT_STYLEMD_PIPELINE_CONFIG,
    ...config,
    viewport: {
      ...DEFAULT_STYLEMD_PIPELINE_CONFIG.viewport,
      ...(config?.viewport ?? {}),
    },
  };
}

function buildCuratedManifestFromComponents(
  runId: string,
  url: string,
  components: StyleMdComponentEntry[],
): StyleMdCuratedManifest {
  const units = components.map((comp, idx) => ({
    unit_id: `unit_${idx + 1}`,
    type: "single" as const,
    component_ids: [comp.componentId] as [string],
    study_label: comp.componentId,
    reason: `Extracted component ${idx + 1}`,
    components: [comp] as [StyleMdComponentEntry],
  }));

  return {
    run_id: runId,
    url,
    curated_at: nowIso(),
    source_manifest_path: "dedup",
    units,
    kept_component_ids: components.map((c) => c.componentId),
    deleted_component_ids: [],
  };
}

export async function runSimplifiedStyleMdPipeline(
  url: string,
  provider: StyleMdProvider = "kimi",
  forcedRunId?: string,
): Promise<{
  runId: string;
  styleMd: string;
  screenshot: string;
  model: string;
}> {
  // Step 3: Auto-recover in pipeline
  await connectDB();
  if (mongoose.connection.readyState !== 1) {
    throw new Error("Mongo not connected after retry");
  }

  const id = forcedRunId || runId();
  const runIdValue = id;
  const abortController = new AbortController();
  const signal = abortController.signal;
  const runtime = resolveStyleMdRuntimeConfig(provider);

  // Step 1 & 2: Collection-based Keep-Alive Ping at 10s frequency
  const keepAliveInterval = setInterval(async () => {
    await mongoKeepAlive();
  }, 10000);

  // 🔴 Mark run pending so the DB record exists for the screenshot
  try {
    await markStyleMdRunPendingInMongo({
      url,
      runId: runIdValue,
      provider: runtime.provider,
      model: runtime.model,
    });
  } catch (e) {
    console.warn("[PIPELINE] early pending persist failed, continuing under unstable network", e);
  }


  // 🔴 STEP 1: MOVE SCRAPE TO START (In-memory only for now)
  runIdLog(runIdValue, `Early scraping ${url}...`);
  const canonUrl = canonicalPageUrl(url);
  const scraped = await scrape(canonUrl);
  
  if (scraped) {
    runIdLog(runIdValue, `[DEBUG] Scrape result: title="${scraped.title}", htmlLength=${scraped.rawHtml?.length ?? 0}, textLength=${scraped.contentText?.length ?? 0}, imagesCount=${scraped.images?.length ?? 0}`);
  } else {
    runIdLog(runIdValue, `[DEBUG] Scrape FAILED (returned null) for ${url}`, "warn");
  }

  // 🔴 STEP 2: OPTIONAL/NON-BLOCKING SCRAPED DATA PERSIST
  if (scraped) {
    // We do NOT wait for this to block the pipeline
    safeWrite(() =>
      ScrapedData.updateOne(
        { url: canonUrl },
        {
          $set: {
            ...scraped,
            url: canonUrl,
            updatedAt: new Date()
          },
          $setOnInsert: { createdAt: new Date() }
        },
        { upsert: true }
      )
    ).catch(e => {
      runIdLog(runIdValue, `[FALLBACK_TRIGGERED] ScrapedData optional persist failed: ${e instanceof Error ? e.message : String(e)}`, "warn");
    });
  }

  const config = mergeConfig({});

  let state = createInitialRunState(runIdValue, url, runtime.provider, runtime.model);
  let aggregateTokenUsage = createEmptyKimiTokenUsage();

  // Use Kimi for curation and generation stages to reduce costs and use high-reasoning models
  const kimiRuntime = resolveStyleMdRuntimeConfig("kimi");

  async function emitAndLog(event: StyleMdPipelineEventPayload): Promise<void> {
    const fullEvent = emitEvent(event as Parameters<typeof emitEvent>[0]);
    await appendStyleMdLogLine(runIdValue, fullEvent);
  }

  async function publishState(): Promise<void> {
    const stateArtifact = await persistStyleMdState(runIdValue, state);
    state = updateRunState(state, {
      artifacts: mergeArtifact(state.artifacts, stateArtifact),
    });
  }

  function registerArtifacts(artifacts: StyleMdArtifactRecord[]): void {
    let nextArtifacts = state.artifacts;
    for (const artifact of artifacts) {
      nextArtifacts = mergeArtifact(nextArtifacts, artifact);
    }
    state = updateRunState(state, {
      artifacts: nextArtifacts,
    });
  }

  async function runStage<T>(
    stage: StyleMdPipelineStageName,
    handler: () => Promise<T>,
  ): Promise<T> {
    assertNotAborted(signal);

    const stageNames: Record<StyleMdPipelineStageName, { num: number; emoji: string }> = {
      capture: { num: 1, emoji: "📸" },
      extract: { num: 2, emoji: "🔍" },
      dedup: { num: 3, emoji: "🎯" },
      curate: { num: 4, emoji: "📋" },
      styleguide: { num: 5, emoji: "✨" },
      showcase: { num: 6, emoji: "🎪" },
    };

    const stageInfo = stageNames[stage] || { num: 0, emoji: "⚙️" };
    console.log(`\n${stageInfo.emoji} [PIPELINE] Stage ${stageInfo.num}/6: ${stage.toUpperCase()}`);

    const startedAt = nowIso();
    const startedMs = Date.now();

    state = updateStageState(state, stage, {
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

      state = updateStageState(state, stage, {
        status: "completed",
        completedAt: nowIso(),
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
    } catch (error) {
      const durationMs = Date.now() - startedMs;
      const stageArtifacts =
        error &&
        typeof error === "object" &&
        "artifacts" in error &&
        Array.isArray((error as { artifacts?: unknown }).artifacts)
          ? ((error as { artifacts: StyleMdArtifactRecord[] }).artifacts)
          : [];
      if (stageArtifacts.length > 0) {
        registerArtifacts(stageArtifacts);
      }
      state = updateStageState(state, stage, {
        status: "failed",
        completedAt: nowIso(),
        durationMs,
        error: errorToMessage(error),
      });
      await emitAndLog({
        type: "stylemd_stage_failed",
        source: "system",
        runId: runIdValue,
        stage,
        error: errorToMessage(error),
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
          error: errorToMessage(error),
        },
      });
      await publishState();
      throw error;
    }
  }

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;

  const closeBrowser = async (): Promise<void> => {
    try {
      await page?.close();
    } catch {
      // Ignore
    }
    try {
      await context?.close();
    } catch {
      // Ignore
    }
    try {
      await browser?.close();
    } catch {
      // Ignore
    }
    page = null;
    context = null;
    browser = null;
  };

  const onAbort = (): void => {
    void closeBrowser();
  };

  signal.addEventListener("abort", onAbort, { once: true });

  await publishState();
  const eventsLogArtifact = await writeStyleMdText(runIdValue, join("logs", "events.ndjson"), "", "text");
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
  let extractionMetadataVar: any = null;

  try {
    browser = await chromium.launch(getPlaywrightLaunchOptions());
    context = await browser.newContext({
      viewport: {
        width: config.viewport.width,
        height: config.viewport.height,
      },
      deviceScaleFactor: config.viewport.deviceScaleFactor,
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    });

    await context.addInitScript(() => {
      (window as any).__name = (t: any, v: any) => t;
    });

    page = await context.newPage();

    await runStage("capture", async () => {
      assertNotAborted(signal);
      await page!.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 90_000,
      });

      console.log(`\n📸 [STYLEMD] Stage 1/6: CAPTURE - Taking screenshot at ${url}`);
      const capture = await runCaptureStage({
        runId: runIdValue,
        page: page!,
        signal,
      });
      fullScreenshotPath = capture.result.fullScreenshotPath;
      
      registerArtifacts(capture.artifacts);
      await publishState();

      // --- Save screenshot to MongoDB immediately after capture ---
      try {
        const buffer = await page!.screenshot({
          type: "jpeg",
          quality: 60,
          fullPage: true,
        });

        const compressedBuffer = await sharp(buffer)
          .resize({ width: 1000, withoutEnlargement: true })
          .jpeg({ quality: 60 })
          .toBuffer();

        if (compressedBuffer.length <= 1_500_000) {
          screenshotBase64Var = `data:image/jpeg;base64,${compressedBuffer.toString("base64")}`;
          
          await safeWrite(() =>
            StyleMdRun.updateOne(
              { runId: runIdValue },
              { 
                $set: { 
                  screenshot: screenshotBase64Var,
                  images: [screenshotBase64Var],
                  updatedAt: new Date()
                } 
              }
            )
          );
          runIdLog(runIdValue, "[SCREENSHOT] Persisted screenshot to MongoDB immediately.");
        }
      } catch (ssErr) {
        console.warn(`[SCREENSHOT] ⚠️ Failed to capture screenshot: ${ssErr instanceof Error ? ssErr.message : String(ssErr)}`);
      }
    });

    const extract = await runStage("extract", async () => {
      const output = await runExtractStage({
        runId: runIdValue,
        page: page!,
        config,
        signal,
      });

      registerArtifacts(output.artifacts);
      aggregateTokenUsage = accumulateKimiTokenUsage(aggregateTokenUsage, output.result.query);
      state = updateRunState(state, {
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
      await mongoKeepAlive();
      return output.result;
    });

    await closeBrowser();

    const dedup = await runStage("dedup", async () => {
      const output = await runDedupStage({
        runId: runIdValue,
        components: extract.components,
        threshold: config.dedupSsimThreshold,
        signal,
      });

      registerArtifacts(output.artifacts);
      state = updateRunState(state, {
        metrics: {
          ...state.metrics,
          dedupedComponents: output.result.keptComponents.length,
          duplicatesDeleted: output.result.deletedComponentIds.length,
        },
      });
      await publishState();
      await mongoKeepAlive();
      return output.result;
    });

    const curate = await runStage("curate", async () => {
      const output = await runCurateStage({
        runId: runIdValue,
        url,
        dedupAgentManifestPath: dedup.dedupAgentManifestPath,
        components: dedup.keptComponents,
        signal,
        runtime: kimiRuntime,
      });

      registerArtifacts(output.artifacts);
      state = updateRunState(state, {
        metrics: {
          ...state.metrics,
          curatedUnits: output.result.curatedManifest.units.length,
          curatedComponents: output.result.keptComponentIds.length,
          curationDeleted: output.result.deletedComponentIds.length,
        },
      });
      await publishState();
      await mongoKeepAlive();
      return output.result;
    });

    let hasStyleguideWarning = false;
    let responsiveHoverEvidencePath: string | undefined;
    let styleguideStageResult: Awaited<ReturnType<typeof runStyleguideStage>>["result"] | null = null;
    
    try {
      styleguideStageResult = await runStage("styleguide", async () => {
        try {
          assertNotAborted(signal);
          browser = await chromium.launch(getPlaywrightLaunchOptions());
          context = await browser.newContext({
            viewport: {
              width: config.viewport.width,
              height: config.viewport.height,
            },
            deviceScaleFactor: config.viewport.deviceScaleFactor,
            userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          });
          page = await context.newPage();

          const enrichment = await runCuratedResponsiveHoverEvidenceStage({
            runId: runIdValue,
            url,
            page: page!,
            curatedManifest: curate.curatedManifest,
            signal,
          });
          responsiveHoverEvidencePath = enrichment.result.evidencePath;
          registerArtifacts(enrichment.artifacts);
          await publishState();
        } catch (error) {
          const warning = `Responsive/hover enrichment failed; continuing. Reason: ${errorToMessage(error)}`;
          state = updateRunState(state, {
            warnings: [...state.warnings, warning],
          });
          await publishState();
        } finally {
          await closeBrowser();
        }

        const output = await runStyleguideStage({
          runId: runIdValue,
          url,
          curatedManifestPath: curate.curatedManifestPath,
          curatedManifest: curate.curatedManifest,
          responsiveHoverEvidencePath,
          signal,
          runtime: kimiRuntime,
        });

        registerArtifacts(output.artifacts);
        aggregateTokenUsage = accumulateKimiTokenUsage(aggregateTokenUsage, output.result.query);
        await publishState();
        await mongoKeepAlive();
        return output.result;
      });
    } catch (error) {
      if (error instanceof StyleguideStageError) {
        hasStyleguideWarning = true;
        if (error.query) {
          aggregateTokenUsage = accumulateKimiTokenUsage(aggregateTokenUsage, error.query);
        }
        state = updateRunState(state, {
          warnings: [...state.warnings, error.warning],
        });
        await publishState();
      } else {
        throw error;
      }
    }

    const showcaseStageResult = await runStage("showcase", async () => {
      const output = await runShowcaseStage({
        runId: runIdValue,
        url,
        curatedManifestPath: curate.curatedManifestPath,
        curatedManifest: curate.curatedManifest,
        responsiveHoverEvidencePath,
        styleMdPath: styleguideStageResult?.styleMdPath ?? join(getStyleMdRunDir(runIdValue), "style.md"),
        styleMarkdown: styleguideStageResult?.styleMarkdown,
        evidenceAgentPath: styleguideStageResult?.evidenceAgentPath ?? join(getStyleMdRunDir(runIdValue), "styleguide", "evidence.agent.json"),
        typographyInventoryPath: styleguideStageResult?.typographyInventoryPath,
        typographyInventory: styleguideStageResult?.typographyInventory,
        requiredTypographyFamilies: styleguideStageResult?.requiredTypographyFamilies,
        fontsManifestPath: extract.fontsManifestPath,
        fontsLocalCssPath: extract.fontsLocalCssPath,
        signal,
        runtime: kimiRuntime,
      });

      registerArtifacts(output.artifacts);
      aggregateTokenUsage = accumulateKimiTokenUsage(aggregateTokenUsage, output.result.query);
      state = updateRunState(state, {
        showcase: output.result.showcase,
      });
      await publishState();
      await mongoKeepAlive();
      return output.result;
    });

    if (showcaseStageResult.warning) {
      state = updateRunState(state, {
        warnings: [...state.warnings, showcaseStageResult.warning],
      });
      await publishState();
    }

    state = updateRunState(state, {
      status: hasStyleguideWarning || state.warnings.length > 0 ? "completed_with_warnings" : "completed",
      completedAt: nowIso(),
    });

    const styleMdContent = styleguideStageResult?.styleMarkdown ?? "";

    // Extract structured design tokens from the stylemd-json block (extract once, persist twice)
    let designTokens: Record<string, unknown> | null = null;
    try {
      const jsonMatch = styleMdContent.match(/```(?:stylemd-json|json)\s*\n([\s\S]*?)```/);
      if (jsonMatch?.[1]) {
        designTokens = JSON.parse(jsonMatch[1]);
        runIdLog(runIdValue, `[DESIGN_TOKENS] Extracted designTokens from stylemd-json block.`);
      }
    } catch (parseErr) {
      runIdLog(runIdValue, `[DESIGN_TOKENS] Failed to parse stylemd-json block: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`, "warn");
    }

    const summary: StyleMdRunSummary = {
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
      costEstimate: estimateKimiCost(runtime.model, aggregateTokenUsage),
      showcase: state.showcase,
    };

    const summaryArtifact = await persistStyleMdSummary(runIdValue, summary);
    state = updateRunState(state, {
      artifacts: mergeArtifact(state.artifacts, summaryArtifact),
    });
    await publishState();

    if (mongoose.connection.readyState !== 1) {
      await connectDB();
    }

    try {
      await persistStyleMdAfterGeneration({
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
    } catch (dbErr) {
      console.error(`Final persist failed: ${errorToMessage(dbErr)}`);
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
  } catch (error) {
    const canceled = signal.aborted || isAbortError(error);

    state = updateRunState(state, {
      status: canceled ? "canceled" : "failed",
      completedAt: nowIso(),
      error: errorToMessage(error),
    });

    await persistStyleMdSummary(runIdValue, {
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
      costEstimate: estimateKimiCost(runtime.model, aggregateTokenUsage),
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
      await connectDB();
      await safeWrite(() =>
        StyleMdRun.updateOne(
          { runId: runIdValue },
          {
            $set: {
              status: finalStatus,
              updatedAt: new Date()
            }
          }
        )
      );
    } catch (dbErr) {
      console.warn(`[PIPELINE] Failed to persist failure status to MongoDB: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`);
    }

    throw error;
  } finally {
    clearInterval(keepAliveInterval);
    signal.removeEventListener("abort", onAbort);
    await closeBrowser();
  }
}