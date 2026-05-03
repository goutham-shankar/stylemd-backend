"use strict";
/**
 * Kimi Integration Bridge
 * Adapts Kimi API to Claude SDK interface for gradual migration
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.queryWithKimiBridge = queryWithKimiBridge;
exports.getKimiOnlyConfig = getKimiOnlyConfig;
const curation_1 = require("@/lib/kimi/curation");
const styleguide_1 = require("@/lib/kimi/styleguide");
/**
 * Query using Kimi AI with hook callbacks
 * Compatible with existing Claude SDK interface
 */
async function queryWithKimiBridge(options) {
    const { workspaceDir, runtime, systemPrompt, prompt, signal, stage, onTokenUsage, } = options;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { onToolStarted, onToolFinished, onToolFailed } = options;
    // Use appropriate Kimi query function based on stage
    if (stage === "curate") {
        return (0, curation_1.runKimiCurationQuery)({
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
    else if (stage === "styleguide" || stage === "showcase") {
        return (0, styleguide_1.runKimiStyleguideQuery)({
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
function getKimiOnlyConfig() {
    return {
        provider: "kimi",
        model: "kimi-k2-thinking",
        env: {
            MOONSHOT_API_KEY: process.env.MOONSHOT_API_KEY || process.env.KIMI_API_KEY || "",
        },
        queryModel: "kimi-k2-thinking",
    };
}
