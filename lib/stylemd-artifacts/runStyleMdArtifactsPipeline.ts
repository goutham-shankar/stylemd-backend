import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import {
  appendStyleMdLogLine,
  getStyleMdRunDir,
  persistStyleMdState,
  persistStyleMdSummary,
  writeStyleMdText,
} from "@/lib/stylemd-artifacts/artifacts";
import { emitEvent } from "@/lib/store/stylemdSessionStore";
import {
  assertNotAborted,
  createInitialRunState,
  errorToMessage,
  isAbortError,
  mergeArtifact,
  nowIso,
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
import { runStyleguideStage, StyleguideStageError } from "@/lib/stylemd-artifacts/styleguide";
import {
  resolveStyleMdRuntimeConfig,
  type StyleMdRuntimeConfig,
} from "@/lib/stylemd-artifacts/provider";
import {
  DEFAULT_STYLEMD_PIPELINE_CONFIG,
  STYLEMD_PIPELINE_STAGES,
  type StyleMdArtifactRecord,
  type StyleMdPipelineConfig,
  type StyleMdPipelineStageName,
  type StyleMdProvider,
  type StyleMdRunState,
  type StyleMdRunSummary,
} from "@/lib/stylemd-artifacts/types";
import type { PlaygroundEvent } from "@/lib/types/stylemdEvents";
import { fileToBase64 } from "@/lib/utils/fileToBase64";
import { markStyleMdRunPendingInMongo, persistStyleMdAfterGeneration } from "@/lib/services/persistStyleMdMongo";

type StyleMdPipelineEventPayload = {
  type: PlaygroundEvent["type"];
  source: PlaygroundEvent["source"];
  [key: string]: unknown;
};

type RunOptions = {
  config?: Partial<StyleMdPipelineConfig>;
  provider?: StyleMdProvider;
  runtime?: StyleMdRuntimeConfig;
  onStateChange?: (state: StyleMdRunState) => void | Promise<void>;
};

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

export async function runStyleMdArtifactsPipeline(
  runId: string,
  url: string,
  abortController: AbortController,
  options: RunOptions = {},
): Promise<StyleMdRunSummary> {
  const signal = abortController.signal;
  const config = mergeConfig(options.config);
  const runtime = options.runtime ?? resolveStyleMdRuntimeConfig(options.provider ?? "claude");

  try {
    await markStyleMdRunPendingInMongo({
      url,
      runId,
      provider: runtime.provider,
      model: runtime.model,
    });
  } catch (err) {
    console.warn(
      "[runStyleMdArtifactsPipeline] Failed to mark run pending in MongoDB:",
      err instanceof Error ? err.message : String(err),
    );
  }

  // Use Kimi for curation and generation stages (curate, styleguide) to reduce costs
  const kimiRuntime = resolveStyleMdRuntimeConfig("kimi");

  let state = createInitialRunState(runId, url, runtime.provider, runtime.model);

  async function emitAndLog(event: StyleMdPipelineEventPayload): Promise<void> {
    const fullEvent = emitEvent(event as Parameters<typeof emitEvent>[0]);
    await appendStyleMdLogLine(runId, fullEvent);
  }

  async function publishState(): Promise<void> {
    const stateArtifact = await persistStyleMdState(runId, state);
    state = updateRunState(state, {
      artifacts: mergeArtifact(state.artifacts, stateArtifact),
    });

    if (options.onStateChange) {
      await options.onStateChange(state);
    }
  }

  function registerArtifacts(artifacts: StyleMdArtifactRecord[]): void {
    let nextArtifacts = state.artifacts;
    for (const artifact of artifacts) {
      nextArtifacts = mergeArtifact(nextArtifacts, artifact);
      void emitAndLog({
        type: "stylemd_artifact_ready",
        source: "system",
        runId,
        artifact,
      });
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
    };

    const stageInfo = stageNames[stage] || { num: 0, emoji: "⚙️" };
    console.log(`\n${stageInfo.emoji} [PIPELINE] Stage ${stageInfo.num}/5: ${stage.toUpperCase()}`);

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

      state = updateStageState(state, stage, {
        status: "completed",
        completedAt: nowIso(),
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
        runId,
        stage,
        error: errorToMessage(error),
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
      // Ignore close failures.
    }
    try {
      await context?.close();
    } catch {
      // Ignore close failures.
    }
    try {
      await browser?.close();
    } catch {
      // Ignore close failures.
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
  const eventsLogArtifact = await writeStyleMdText(runId, join("logs", "events.ndjson"), "", "text");
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
    stages: [...STYLEMD_PIPELINE_STAGES],
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
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({
      viewport: {
        width: config.viewport.width,
        height: config.viewport.height,
      },
      deviceScaleFactor: config.viewport.deviceScaleFactor,
    });

    await context.addInitScript(() => {
      (window as any).__name = (t: any, v: any) => t;
    });

    page = await context.newPage();

    await runStage("capture", async () => {
      assertNotAborted(signal);
      await page!.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      });

      console.log(`\n📸 [PIPELINE] Stage 1: CAPTURE - Taking screenshot at ${url}`);
      const capture = await runCaptureStage({
        runId,
        page: page!,
        signal,
      });
      console.log(`✅ [PIPELINE] Stage 1 complete: captured ${capture.result.viewport.width}x${capture.result.viewport.height}px`);

      registerArtifacts(capture.artifacts);
      await publishState();
    });

    const extract = await runStage("extract", async () => {
      const output = await runExtractStage({
        runId,
        page: page!,
        config,
        signal,
      });

      registerArtifacts(output.artifacts);
      state = updateRunState(state, {
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
      const output = await runDedupStage({
        runId,
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

      return output.result;
    });

    const curate = await runStage("curate", async () => {
      const output = await runCurateStage({
        runId,
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

      return output.result;
    });

    let hasStyleguideWarning = false;
    let responsiveHoverEvidencePath: string | undefined;
    let styleguideStageResult: Awaited<ReturnType<typeof runStyleguideStage>>["result"] | null = null;
    try {
      styleguideStageResult = await runStage("styleguide", async () => {
        try {
          assertNotAborted(signal);
          browser = await chromium.launch({ headless: true });
          context = await browser.newContext({
            viewport: {
              width: config.viewport.width,
              height: config.viewport.height,
            },
            deviceScaleFactor: config.viewport.deviceScaleFactor,
          });

          await context.addInitScript(() => {
            (window as any).__name = (t: any, v: any) => t;
          });
          page = await context.newPage();

          const enrichment = await runCuratedResponsiveHoverEvidenceStage({
            runId,
            url,
            page: page!,
            curatedManifest: curate.curatedManifest,
            signal,
          });
          responsiveHoverEvidencePath = enrichment.result.evidencePath;
          registerArtifacts(enrichment.artifacts);
          await publishState();
        } catch (error) {
          const warning = `Responsive/hover enrichment failed; continuing with available curated evidence. Reason: ${errorToMessage(error)}`;
          state = updateRunState(state, {
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
        } finally {
          await closeBrowser();
        }

        const output = await runStyleguideStage({
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
    } catch (error) {
      if (error instanceof StyleguideStageError) {
        hasStyleguideWarning = true;
        const warning = error.warning;
        state = updateRunState(state, {
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
      } else {
        throw error;
      }
    }



    state = updateRunState(state, {
      status: hasStyleguideWarning || state.warnings.length > 0 ? "completed_with_warnings" : "completed",
      completedAt: nowIso(),
    });

    const summary: StyleMdRunSummary = {
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

    const summaryArtifact = await persistStyleMdSummary(runId, summary);
    state = updateRunState(state, {
      artifacts: mergeArtifact(state.artifacts, summaryArtifact),
    });
    await publishState();
    await emitAndLog({
      type: "stylemd_run_completed",
      source: "system",
      runId,
      provider: runtime.provider,
      model: runtime.model,
      status: summary.status,
      completedAt: summary.completedAt,
      warnings: summary.warnings,
      showcase: {
        available: summary.showcase.available,
        canonicalUrl: summary.showcase.canonicalUrl,
        latestUrl: summary.showcase.latestUrl,
      },
    });

    try {
      const styleMdPath =
        styleguideStageResult?.styleMdPath ?? join(getStyleMdRunDir(runId), "style.md");
      let styleMdContent = "";
      try {
        styleMdContent = await readFile(styleMdPath, "utf-8");
      } catch {
        styleMdContent = styleguideStageResult?.styleMarkdown ?? "";
      }

      let screenshotUrlPath = `/styleguide-files/${runId}/full_screenshot.png`;
      let screenshotBase64 = "";
      try {
        screenshotBase64 = await fileToBase64(join(getStyleMdRunDir(runId), "full_screenshot.png"), "image/png");
      } catch {
        screenshotUrlPath = "";
        screenshotBase64 = "";
      }

      await persistStyleMdAfterGeneration({
        url,
        runId,
        provider: runtime.provider,
        model: runtime.model,
        styleMd: styleMdContent,
        screenshotUrl: screenshotUrlPath,
        screenshot: screenshotBase64,
        runStatus: summary.status,
      });
    } catch (dbErr) {
      console.warn(
        `[runStyleMdArtifactsPipeline] MongoDB persist failed: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`,
      );
    }

    return {
      ...summary,
      artifacts: state.artifacts,
    };
  } catch (error) {
    const canceled = signal.aborted || isAbortError(error);

    state = updateRunState(state, {
      status: canceled ? "canceled" : "failed",
      completedAt: nowIso(),
      error: errorToMessage(error),
    });

    const summary: StyleMdRunSummary = {
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

    await persistStyleMdSummary(runId, summary);
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
      await persistStyleMdAfterGeneration({
        url,
        runId,
        provider: runtime.provider,
        model: runtime.model,
        styleMd: "",
        screenshotUrl: "",
        screenshot: "",
        runStatus: summary.status,
      });
    } catch (dbErr) {
      console.warn(
        `[runStyleMdArtifactsPipeline] MongoDB persist (terminal state) failed: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`,
      );
    }

    return summary;
  } finally {
    signal.removeEventListener("abort", onAbort);
    await closeBrowser();
  }
}
