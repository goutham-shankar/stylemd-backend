import { join } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { readFile } from "node:fs/promises";
import { fileToBase64 } from "@/lib/utils/fileToBase64";
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
  isAbortError,
  mergeArtifact,
  nowIso,
  updateRunState,
  updateStageState,
} from "@/lib/stylemd-artifacts/helpers";
import {
  runCaptureStage,
  runDedupStage,
  runExtractStage,
} from "@/lib/stylemd-artifacts/stages";
import { runStyleguideStage, StyleguideStageError } from "@/lib/stylemd-artifacts/styleguide";
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
): Promise<{
  runId: string;
  styleMd: string;
  screenshotUrl: string;
  screenshot: string;
  model: string;
}> {
  const id = runId();
  const runIdValue = id;
  const abortController = new AbortController();
  const signal = abortController.signal;
  const runtime = resolveStyleMdRuntimeConfig(provider);

  const config = mergeConfig({});

  let state = createInitialRunState(runIdValue, url, runtime.provider, runtime.model);

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
    stage: "capture" | "extract" | "dedup" | "styleguide",
    handler: () => Promise<T>,
  ): Promise<T> {
    assertNotAborted(signal);

    const stageNames: Record<"capture" | "extract" | "dedup" | "styleguide", { num: number; emoji: string }> = {
      capture: { num: 1, emoji: "📸" },
      extract: { num: 2, emoji: "🔍" },
      dedup: { num: 3, emoji: "🎯" },
      styleguide: { num: 4, emoji: "✨" },
    };

    const stageInfo = stageNames[stage];
    console.log(`\n${stageInfo.emoji} [SIMPLE PIPELINE] Stage ${stageInfo.num}/4: ${stage.toUpperCase()}`);

    const startedAt = nowIso();
    const startedMs = Date.now();

    state = updateStageState(state, stage as "capture" | "extract" | "dedup" | "styleguide", {
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

      state = updateStageState(state, stage as "capture" | "extract" | "dedup" | "styleguide", {
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
      await publishState();
      return output;
    } catch (error) {
      const durationMs = Date.now() - startedMs;
      state = updateStageState(state, stage as "capture" | "extract" | "dedup" | "styleguide", {
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
    stages: ["capture", "extract", "dedup", "styleguide"],
  });

  let fullScreenshotPath = "";

  try {
    browser = await chromium.launch({
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
      (window as any).__name = (t: any, v: any) => t;
    });

    page = await context.newPage();

    await runStage("capture", async () => {
      assertNotAborted(signal);
      await page!.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 90_000,
      });

      console.log(`\n📸 [SIMPLE PIPELINE] Stage 1: CAPTURE - Taking screenshot at ${url}`);
      const capture = await runCaptureStage({
        runId: runIdValue,
        page: page!,
        signal,
      });
      fullScreenshotPath = capture.result.fullScreenshotPath;
      console.log(`✅ [SIMPLE PIPELINE] Stage 1 complete: captured ${capture.result.viewport.width}x${capture.result.viewport.height}px`);

      registerArtifacts(capture.artifacts);
      await publishState();
    });

    const extract = await runStage("extract", async () => {
      const output = await runExtractStage({
        runId: runIdValue,
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

      return output.result;
    });

    const curatedManifest = buildCuratedManifestFromComponents(
      runIdValue,
      url,
      dedup.keptComponents,
    );

    const curatedManifestArtifact = await writeStyleMdJson(runIdValue, "curated.json", curatedManifest);
    registerArtifacts([curatedManifestArtifact]);

    const curatedManifestPath = curatedManifestArtifact.path;

    let styleguideStageResult: Awaited<ReturnType<typeof runStyleguideStage>>["result"] | null = null;
    try {
      styleguideStageResult = await runStage("styleguide", async () => {
        try {
          assertNotAborted(signal);
          browser = await chromium.launch({
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
            (window as any).__name = (t: any, v: any) => t;
          });
          page = await context.newPage();
        } catch (error) {
          const warning = `Browser relaunch failed for styleguide stage; continuing. Reason: ${errorToMessage(error)}`;
          state = updateRunState(state, {
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

        const output = await runStyleguideStage({
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
    } catch (error) {
      if (error instanceof StyleguideStageError) {
        const warning = error.warning;
        state = updateRunState(state, {
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
      } else {
        throw error;
      }
    }

    state = updateRunState(state, {
      status: state.warnings.length > 0 ? "completed_with_warnings" : "completed",
      completedAt: nowIso(),
    });

    const styleMdPath = styleguideStageResult?.styleMdPath ?? join(getStyleMdRunDir(runIdValue), "style.md");
    let styleMdContent = "";
    try {
      styleMdContent = await readFile(styleMdPath, "utf-8");
    } catch {
      styleMdContent = styleguideStageResult?.styleMarkdown ?? "";
    }

let screenshotUrlPath = "";
    let screenshotBase64 = "";
    try {
      const screenshotPath = join(getStyleMdRunDir(runIdValue), "full_screenshot.png");
      screenshotUrlPath = `/styleguide-files/${runIdValue}/full_screenshot.png`;
      // Convert screenshot to base64
      screenshotBase64 = await fileToBase64(screenshotPath, "image/png");
      console.log(`[SIMPLE PIPELINE] Screenshot saved as base64 (size: ${screenshotBase64.length} bytes)`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.warn(`[SIMPLE PIPELINE] Screenshot unavailable: ${errMsg}`);
      // Leave both paths as empty strings; the controller stores them as undefined
      // (falsy check) so the frontend can distinguish missing from not-yet-generated.
    }

    const summary: StyleMdRunSummary = {
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

    const summaryArtifact = await persistStyleMdSummary(runIdValue, summary);
    state = updateRunState(state, {
      artifacts: mergeArtifact(state.artifacts, summaryArtifact),
    });
    await publishState();
    await emitAndLog({
      type: "stylemd_run_completed",
      source: "system",
      runId: runIdValue,
      provider: runtime.provider,
      model: runtime.model,
      status: summary.status,
      completedAt: summary.completedAt,
      warnings: summary.warnings,
    });

    return {
      runId: runIdValue,
      styleMd: styleMdContent,
      screenshotUrl: screenshotUrlPath,
      screenshot: screenshotBase64,
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
      showcase: {
        available: false,
        canonicalUrl: "",
        latestUrl: "",
      },
    });
    await publishState();

    throw error;
  } finally {
    signal.removeEventListener("abort", onAbort);
    await closeBrowser();
  }
}