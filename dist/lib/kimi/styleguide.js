"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runKimiStyleguideQuery = runKimiStyleguideQuery;
const client_1 = require("@/lib/kimi/client");
function isRateLimitError(error) {
    const message = error instanceof Error ? error.message : String(error);
    const normalized = message.toLowerCase();
    return normalized.includes("429")
        || normalized.includes("rate limit")
        || normalized.includes("rate_limit")
        || normalized.includes("tpd");
}
/**
 * Execute a styleguide/showcase query using Kimi AI
 * Uses unlimited reasoning steps for high-quality generation
 */
async function runKimiStyleguideQuery(input) {
    const { workspaceDir, systemPrompt, prompt, onTokenUsage, } = input;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { signal, runId } = input;
    console.log(`\n✨ [KIMI] Running STYLEGUIDE/SHOWCASE stage for run: ${runId}`);
    console.log(`   Workspace: ${workspaceDir}`);
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
    try {
        const result = await client.query(systemPrompt, prompt, workspaceDir, tools, {
            maxSteps: 300, // Unlimited reasoning for generation quality
            onToken: (usage) => {
                console.log(`   Cumulative tokens - Input: ${usage.input_tokens}, Output: ${usage.output_tokens}`);
                onTokenUsage?.(usage.input_tokens, usage.output_tokens);
            },
        });
        console.log(`✅ [KIMI] STYLEGUIDE/SHOWCASE stage complete\n`);
        return result.text;
    }
    catch (error) {
        if (isRateLimitError(error)) {
            console.warn(`⚠️  [KIMI] STYLEGUIDE/SHOWCASE stage rate-limited; styleguide fallback may be applied by orchestrator`);
        }
        else {
            console.error(`❌ [KIMI] STYLEGUIDE/SHOWCASE stage failed`);
        }
        throw new Error(`Kimi styleguide query failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}
