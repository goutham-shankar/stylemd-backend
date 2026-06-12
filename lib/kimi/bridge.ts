/**
 * Kimi Integration Bridge
 * Adapts Kimi API to standard interface
 */

import { runKimiCurationQuery } from "@/lib/kimi/curation";
import { runKimiStyleguideQuery } from "@/lib/kimi/styleguide";
import type { StyleMdRuntimeConfig } from "@/lib/stylemd-artifacts/provider";

export interface KimiBridgeOptions {
  runId: string;
  workspaceDir: string;
  runtime: StyleMdRuntimeConfig;
  systemPrompt: string;
  prompt: string;
  signal: AbortSignal;
  queryLabel?: string;
  stage: "curate" | "styleguide" | "showcase";
  onTokenUsage?: (inputTokens: number, outputTokens: number) => void;
  onToolStarted?: (name: string, toolUseId: string, input: unknown) => void;
  onToolFinished?: (name: string, toolUseId: string, output: unknown) => void;
  onToolFailed?: (name: string, toolUseId: string, error: string) => void;
}

/**
 * Query using Kimi AI with hook callbacks
 */
export async function queryWithKimiBridge(options: KimiBridgeOptions): Promise<string> {
  const {
    workspaceDir,
    runtime,
    systemPrompt,
    prompt,
    signal,
    stage,
    onTokenUsage,
  } = options;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { onToolStarted, onToolFinished, onToolFailed } = options;

  // Use appropriate Kimi query function based on stage
  if (stage === "curate") {
    return runKimiCurationQuery({
      runId: options.runId,
      workspaceDir,
      runtime,
      systemPrompt,
      prompt,
      signal,
      queryLabel: options.queryLabel,
      onTokenUsage,
    });
  } else if (stage === "styleguide" || stage === "showcase") {
    return runKimiStyleguideQuery({
      runId: options.runId,
      workspaceDir,
      runtime,
      systemPrompt,
      prompt,
      signal,
      queryLabel: options.queryLabel,
      onTokenUsage,
    });
  }

  throw new Error(`Unknown stage: ${stage}`);
}

/**
 * Force all stages to use Kimi
 */
export function getKimiOnlyConfig(): StyleMdRuntimeConfig {
  return {
    provider: "kimi",
    model: "kimi-k2.5",
    env: {
      MOONSHOT_API_KEY: process.env.MOONSHOT_API_KEY || process.env.KIMI_API_KEY || "",
    },
    queryModel: "kimi-k2.5",
  };
}
