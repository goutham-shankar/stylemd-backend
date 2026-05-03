"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.STYLEMD_KIMI_MODEL = void 0;
exports.resolveDefaultClaudeModel = resolveDefaultClaudeModel;
exports.resolveStyleMdRuntimeConfig = resolveStyleMdRuntimeConfig;
exports.validateStyleMdProviderCredentials = validateStyleMdProviderCredentials;
exports.STYLEMD_KIMI_MODEL = "kimi-k2.5";
const KIMI_ANTHROPIC_BASE_URL = "https://api.moonshot.ai/anthropic";
function resolveDefaultClaudeModel() {
    const configured = process.env.CLAUDE_MODEL?.trim() || process.env.ANTHROPIC_MODEL?.trim();
    return configured || "default";
}
function resolveClaudeRuntimeConfig() {
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
function resolveKimiRuntimeConfig() {
    const kimiApiKey = process.env.KIMI_API_KEY?.trim();
    if (!kimiApiKey) {
        throw new Error("KIMI_API_KEY is required for stylemd artifact runs when provider is kimi.");
    }
    return {
        provider: "kimi",
        model: exports.STYLEMD_KIMI_MODEL,
        queryModel: exports.STYLEMD_KIMI_MODEL,
        env: {
            ...process.env,
            ANTHROPIC_BASE_URL: KIMI_ANTHROPIC_BASE_URL,
            ANTHROPIC_AUTH_TOKEN: kimiApiKey,
            ANTHROPIC_API_KEY: undefined,
        },
    };
}
function resolveStyleMdRuntimeConfig(provider) {
    if (provider === "kimi") {
        return resolveKimiRuntimeConfig();
    }
    return resolveClaudeRuntimeConfig();
}
function validateStyleMdProviderCredentials(provider) {
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
