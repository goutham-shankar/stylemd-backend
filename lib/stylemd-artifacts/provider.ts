import type { StyleMdProvider } from "@/lib/stylemd-artifacts/types";

export const STYLEMD_KIMI_MODEL = "kimi-k2.5";
const KIMI_ANTHROPIC_BASE_URL = "https://api.moonshot.ai/anthropic";

export type StyleMdRuntimeConfig = {
  provider: StyleMdProvider;
  model: string;
  queryModel?: string;
  env: Record<string, string | undefined>;
};

export function resolveDefaultClaudeModel(): string {
  const configured = process.env.CLAUDE_MODEL?.trim() || process.env.ANTHROPIC_MODEL?.trim();
  return configured || "default";
}

function resolveClaudeRuntimeConfig(): StyleMdRuntimeConfig {
  const configured = process.env.CLAUDE_MODEL?.trim() || process.env.ANTHROPIC_MODEL?.trim();
  return {
    provider: "claude",
    model: configured || "default",
    queryModel: configured || undefined,
    env: {
      ...process.env,
    },
  };
}

function resolveKimiRuntimeConfig(): StyleMdRuntimeConfig {
  const kimiApiKey = process.env.KIMI_API_KEY?.trim();
  if (!kimiApiKey) {
    throw new Error("KIMI_API_KEY is required for stylemd artifact runs when provider is kimi.");
  }

  return {
    provider: "kimi",
    model: STYLEMD_KIMI_MODEL,
    queryModel: STYLEMD_KIMI_MODEL,
    env: {
      ...process.env,
      ANTHROPIC_BASE_URL: KIMI_ANTHROPIC_BASE_URL,
      ANTHROPIC_AUTH_TOKEN: kimiApiKey,
      ANTHROPIC_API_KEY: undefined,
    },
  };
}

export function resolveStyleMdRuntimeConfig(provider: StyleMdProvider): StyleMdRuntimeConfig {
  if (provider === "kimi") {
    return resolveKimiRuntimeConfig();
  }
  return resolveClaudeRuntimeConfig();
}

export function validateStyleMdProviderCredentials(provider: StyleMdProvider): string | null {
  if (provider === "kimi") {
    if (!process.env.KIMI_API_KEY?.trim()) {
      return "KIMI_API_KEY is required for stylemd artifact runs when provider is kimi.";
    }
    return null;
  }

  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    return "ANTHROPIC_API_KEY is required for stylemd artifact runs when provider is claude.";
  }
  return null;
}
