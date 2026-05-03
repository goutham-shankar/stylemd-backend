"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runKimiCurationQuery = runKimiCurationQuery;
const client_1 = require("@/lib/kimi/client");
function isRateLimitError(error) {
    const message = error instanceof Error ? error.message : String(error);
    const normalized = message.toLowerCase();
    return normalized.includes("429")
        || normalized.includes("rate limit")
        || normalized.includes("rate_limit")
        || normalized.includes("tpd");
}
function isTransientNetworkError(error) {
    const message = error instanceof Error ? error.message : String(error);
    const normalized = message.toLowerCase();
    return normalized.includes("fetch failed")
        || normalized.includes("network")
        || normalized.includes("timeout")
        || normalized.includes("econnreset")
        || normalized.includes("econnrefused")
        || normalized.includes("enotfound")
        || normalized.includes("eai_again")
        || normalized.includes("etimedout")
        || normalized.includes("502")
        || normalized.includes("503")
        || normalized.includes("504");
}
/**
 * Execute a curation query using Kimi AI
 * Replaces Claude SDK query with Kimi API
 * Includes retry logic for rate limiting
 */
async function runKimiCurationQuery(input) {
    const { workspaceDir, systemPrompt, prompt, onTokenUsage, maxRetries = 2, retryDelayMs = 5000, } = input;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { signal, runId } = input;
    console.log(`\n📋 [KIMI] Running CURATION stage for run: ${runId}`);
    console.log(`   Workspace: ${workspaceDir}`);
    const configuredMaxSteps = Number(process.env.STYLEMD_KIMI_CURATION_MAX_STEPS);
    const maxSteps = Number.isFinite(configuredMaxSteps) && configuredMaxSteps > 0
        ? Math.floor(configuredMaxSteps)
        : 90;
    const client = new client_1.KimiClient();
    const tools = [
        {
            type: "function",
            function: {
                name: "Read",
                description: "Read contents of a text file with optional offset/limit",
                parameters: {
                    type: "object",
                    properties: {
                        file_path: { type: "string", description: "Path to file relative to workspace" },
                        offset: { type: "number", minimum: 0, description: "Byte offset to start reading" },
                        limit: { type: "number", minimum: 0, description: "Maximum bytes to read" },
                    },
                    required: ["file_path"],
                },
            },
        },
        {
            type: "function",
            function: {
                name: "Grep",
                description: "Search for pattern in file",
                parameters: {
                    type: "object",
                    properties: {
                        file_path: { type: "string", description: "Path to file" },
                        pattern: { type: "string", description: "Regex pattern to search for" },
                    },
                    required: ["file_path", "pattern"],
                },
            },
        },
        {
            type: "function",
            function: {
                name: "Glob",
                description: "List files matching glob pattern",
                parameters: {
                    type: "object",
                    properties: {
                        pattern: { type: "string", description: "Glob pattern (e.g., **/*.json)" },
                        max_results: { type: "number", description: "Maximum files to return" },
                    },
                    required: ["pattern"],
                },
            },
        },
        {
            type: "function",
            function: {
                name: "LS",
                description: "List directory contents",
                parameters: {
                    type: "object",
                    properties: {
                        dir_path: { type: "string", description: "Directory path relative to workspace" },
                    },
                    required: ["dir_path"],
                },
            },
        },
    ];
    // Retry loop for rate limit handling
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            // Prioritize curation accuracy with a higher reasoning budget.
            // This can be tuned via STYLEMD_KIMI_CURATION_MAX_STEPS.
            const result = await client.query(systemPrompt, prompt, workspaceDir, tools, {
                maxSteps,
                onToken: (usage) => {
                    console.log(`   Cumulative tokens - Input: ${usage.input_tokens}, Output: ${usage.output_tokens}`);
                    onTokenUsage?.(usage.input_tokens, usage.output_tokens);
                },
            });
            console.log(`✅ [KIMI] CURATION stage complete\n`);
            return result.text;
        }
        catch (error) {
            const isRateLimit = isRateLimitError(error);
            const isTransient = isTransientNetworkError(error);
            const isLastAttempt = attempt >= maxRetries;
            if (isRateLimit) {
                if (isLastAttempt) {
                    console.warn(`⚠️  [KIMI] CURATION stage rate-limited after ${attempt + 1} attempts; deterministic fallback will be applied by orchestrator`);
                }
                else {
                    const delayS = (retryDelayMs / 1000).toFixed(1);
                    console.warn(`⚠️  [KIMI] Rate limit hit. Retrying in ${delayS}s (attempt ${attempt + 1}/${maxRetries})...`);
                    await new Promise(resolve => setTimeout(resolve, retryDelayMs));
                    continue;
                }
            }
            else if (isTransient && !isLastAttempt) {
                const delayS = (retryDelayMs / 1000).toFixed(1);
                console.warn(`⚠️  [KIMI] Transient network error. Retrying in ${delayS}s (attempt ${attempt + 1}/${maxRetries})...`);
                await new Promise(resolve => setTimeout(resolve, retryDelayMs));
                continue;
            }
            else {
                console.error(`❌ [KIMI] CURATION stage failed`);
            }
            throw new Error(`Kimi curation query failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    throw new Error("Kimi curation query failed: max retries exceeded");
}
