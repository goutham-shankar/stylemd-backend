"use strict";
/**
 * Centralised environment configuration.
 * All env reads go through here so the rest of the app never calls process.env directly.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
exports.config = {
    port: parseInt(process.env.PORT || "3002", 10),
    get mongoUri() {
        const uri = process.env.MONGO_URI;
        if (!uri) {
            throw new Error("MONGO_URI environment variable is required. Set it in your .env.local file.");
        }
        return uri;
    },
    mongoDbName: process.env.MONGO_DB_NAME || "stylemd",
    kimiApiKey: process.env.KIMI_API_KEY || "",
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
    claudeModel: process.env.CLAUDE_MODEL?.trim() ||
        process.env.ANTHROPIC_MODEL?.trim() ||
        "default",
    playgroundLogToFile: process.env.PLAYGROUND_LOG_TO_FILE === "true",
    styleMdKimiCurationMaxSteps: parseInt(process.env.STYLEMD_KIMI_CURATION_MAX_STEPS || "80", 10),
    nodeEnv: process.env.NODE_ENV || "development",
};
