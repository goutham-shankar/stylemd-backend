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
  if (error instanceof StyleMdPipelineAbortedError) {
    return true;
  }

  if (error instanceof Error) {
    const name = error.name.toLowerCase();
    const message = error.message.toLowerCase();
    return name.includes("abort") || message.includes("abort") || message.includes("cancel");
  }

  return false;
}

export function getPlaywrightLaunchOptions() {
  return {
    executablePath: process.env.PLAYWRIGHT_CHROME_PATH || "/usr/bin/google-chrome",
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-sync",
      "--no-first-run",
    ],
  };
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
