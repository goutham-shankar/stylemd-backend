"use strict";
/**
 * Centralised environment configuration.
 * All env reads go through here so the rest of the app never calls process.env directly.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
exports.config = {
    port: parseInt(process.env.PORT || "3000", 10),
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
    // Queue / Redis
    get redisUrl() {
        const v = process.env.REDIS_URL;
        if (!v)
            throw new Error("REDIS_URL environment variable is required");
        return v;
    },
    workerConcurrency: parseInt(process.env.WORKER_CONCURRENCY || "2", 10),
    queueMaxWaiting: parseInt(process.env.QUEUE_MAX_WAITING || "500", 10),
    // R2 / object storage
    get r2() {
        const endpoint = process.env.R2_ENDPOINT;
        const key = process.env.R2_KEY;
        const secret = process.env.R2_SECRET;
        const bucket = process.env.R2_BUCKET;
        const publicBase = process.env.R2_PUBLIC_BASE;
        if (!endpoint || !key || !secret || !bucket || !publicBase) {
            throw new Error("R2_ENDPOINT, R2_KEY, R2_SECRET, R2_BUCKET, R2_PUBLIC_BASE are all required");
        }
        return { endpoint, key, secret, bucket, publicBase };
    },
    adminToken: process.env.ADMIN_TOKEN || "",
};
