import type { StyleMdProvider } from "@/lib/stylemd-artifacts/types";

export const STYLEMD_KIMI_MODEL = "kimi-k2.5";
const KIMI_MODEL_ALLOWLIST = new Set([
  "kimi-k2.5",
  "kimi-k2.6",
  "kimi-k2.7-code",
  "kimi-k2.7-code-highspeed",
]);
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

function resolveKimiModel(modelOverride?: string): string {
  const configured = modelOverride?.trim() || process.env.STYLEMD_KIMI_MODEL?.trim() || STYLEMD_KIMI_MODEL;
  if (!KIMI_MODEL_ALLOWLIST.has(configured)) {
    throw new Error(
      `Unsupported Kimi model '${configured}'. Supported models: ${[...KIMI_MODEL_ALLOWLIST].join(", ")}`,
    );
  }
  return configured;
}

function resolveKimiRuntimeConfig(modelOverride?: string): StyleMdRuntimeConfig {
  const kimiApiKey = process.env.KIMI_API_KEY?.trim();
  if (!kimiApiKey) {
    console.error("[PIPELINE] [DEBUG] KIMI_API_KEY IS MISSING IN ENVIRONMENT!");
    throw new Error("KIMI_API_KEY is required for stylemd artifact runs when provider is kimi.");
  }

  console.log("[PIPELINE] [DEBUG] KIMI_API_KEY loaded successfully.");
  const model = resolveKimiModel(modelOverride);

  return {
    provider: "kimi",
    model,
    queryModel: model,
    env: {
      ...process.env,
      ANTHROPIC_BASE_URL: KIMI_ANTHROPIC_BASE_URL,
      ANTHROPIC_AUTH_TOKEN: kimiApiKey,
      ANTHROPIC_API_KEY: undefined,
    },
  };
}

export function resolveStyleMdRuntimeConfig(
  provider: StyleMdProvider,
  options?: { model?: string },
): StyleMdRuntimeConfig {
  if (provider === "kimi") {
    return resolveKimiRuntimeConfig(options?.model);
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
