import {
  listStyleMdRunIdsFromDisk,
  readStyleMdState,
  readStyleMdSummary,
} from "@/lib/stylemd-artifacts/artifacts";
import { makeRunId } from "@/lib/stylemd-artifacts/helpers";
import { resolveDefaultClaudeModel } from "@/lib/stylemd-artifacts/provider";
import { runStyleMdArtifactsPipeline } from "@/lib/stylemd-artifacts/runStyleMdArtifactsPipeline";
import type { StyleMdProvider, StyleMdRunState, StyleMdRunSummary } from "@/lib/stylemd-artifacts/types";

type ActiveRun = {
  runId: string;
  abortController: AbortController;
  promise: Promise<StyleMdRunSummary>;
};

const GLOBAL_KEY = "__stylemd_artifact_pipeline_manager__";

function withShowcaseDefaults(summary: StyleMdRunSummary): StyleMdRunSummary {
  const showcase = (summary.showcase ?? {}) as Partial<StyleMdRunSummary["showcase"]>;
  return {
    ...summary,
    provider: summary.provider ?? "claude",
    model: summary.model ?? resolveDefaultClaudeModel(),
    showcase: {
      available: showcase.available ?? false,
      canonicalUrl: showcase.canonicalUrl ?? `/styleguide/${summary.runId}`,
      latestUrl: showcase.latestUrl ?? "/styleguide",
      htmlPath: showcase.htmlPath,
      validationPath: showcase.validationPath,
      warning: showcase.warning,
    },
  };
}

function toSummary(state: StyleMdRunState): StyleMdRunSummary {
  return withShowcaseDefaults({
    runId: state.runId,
    provider: state.provider,
    model: state.model,
    url: state.url,
    status: state.status,
    startedAt: state.startedAt,
    completedAt: state.completedAt,
    error: state.error,
    warnings: state.warnings,
    artifacts: state.artifacts,
    metrics: state.metrics,
    showcase: state.showcase,
  });
}

function getGlobalState(): {
  active: ActiveRun | null;
  summaries: Map<string, StyleMdRunSummary>;
} {
  const globalObject = globalThis as typeof globalThis & {
    [GLOBAL_KEY]?: {
      active: ActiveRun | null;
      summaries: Map<string, StyleMdRunSummary>;
    };
  };

  if (!globalObject[GLOBAL_KEY]) {
    globalObject[GLOBAL_KEY] = {
      active: null,
      summaries: new Map<string, StyleMdRunSummary>(),
    };
  }

  return globalObject[GLOBAL_KEY];
}

export function getActiveStyleMdRunId(): string | null {
  return getGlobalState().active?.runId ?? null;
}

export async function startStyleMdRun(
  url: string,
  provider: StyleMdProvider = "claude",
): Promise<{ runId: string }> {
  const state = getGlobalState();
  if (state.active) {
    throw new Error(`A style artifact run is already active: ${state.active.runId}`);
  }

  const runId = makeRunId();
  const abortController = new AbortController();

  const promise = runStyleMdArtifactsPipeline(runId, url, abortController, {
    provider,
    onStateChange: (nextState) => {
      const current = getGlobalState();
      current.summaries.set(runId, toSummary(nextState));
    },
  })
    .then((summary) => {
      const current = getGlobalState();
      current.summaries.set(runId, summary);
      if (current.active?.runId === runId) {
        current.active = null;
      }
      return summary;
    })
    .catch((error) => {
      const current = getGlobalState();
      if (current.active?.runId === runId) {
        current.active = null;
      }
      throw error;
    });

  state.active = {
    runId,
    abortController,
    promise,
  };

  return { runId };
}

export async function cancelActiveStyleMdRun(): Promise<{ canceled: boolean; runId: string | null }> {
  const state = getGlobalState();
  if (!state.active) {
    return {
      canceled: false,
      runId: null,
    };
  }

  const runId = state.active.runId;
  state.active.abortController.abort();

  return {
    canceled: true,
    runId,
  };
}

export async function getStyleMdRunSummary(runId: string): Promise<StyleMdRunSummary | null> {
  const state = getGlobalState();
  const inMemory = state.summaries.get(runId);
  if (inMemory) {
    return withShowcaseDefaults(inMemory);
  }

  const fromDiskSummary = await readStyleMdSummary(runId);
  if (fromDiskSummary) {
    const normalized = withShowcaseDefaults(fromDiskSummary);
    state.summaries.set(runId, normalized);
    return normalized;
  }

  const fromDiskState = await readStyleMdState(runId);
  if (fromDiskState) {
    const summary = toSummary(fromDiskState);
    state.summaries.set(runId, summary);
    return summary;
  }

  return null;
}

export async function listStyleMdRunSummaries(): Promise<StyleMdRunSummary[]> {
  const state = getGlobalState();
  const runIds = new Set<string>([
    ...state.summaries.keys(),
    ...(await listStyleMdRunIdsFromDisk()),
  ]);

  const results: StyleMdRunSummary[] = [];
  for (const runId of runIds) {
    const summary = await getStyleMdRunSummary(runId);
    if (summary) {
      results.push(summary);
    }
  }

  results.sort((a, b) => {
    const aTime = Date.parse(a.completedAt ?? a.startedAt);
    const bTime = Date.parse(b.completedAt ?? b.startedAt);
    return bTime - aTime;
  });

  return results;
}

export async function getLatestStyleMdShowcaseRunSummary(): Promise<StyleMdRunSummary | null> {
  const summaries = await listStyleMdRunSummaries();
  return summaries.find((summary) => summary.showcase.available) ?? null;
}
