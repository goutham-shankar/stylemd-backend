"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Backend entry point.
 */
require("dotenv/config");
const mongoose_1 = __importDefault(require("mongoose"));
const mongodb_1 = require("../../lib/mongodb");
const app_1 = require("./app");
const env_1 = require("./config/env");
async function start() {
    console.log("---------------------------------------------------------------------------");
    console.log(`[startup] BUILD_ID: ${Date.now()}`); // Detect stale PM2 dist code
    console.log(`[startup] booting Design Probe backend on port ${env_1.config.port}`);
    console.log(`[startup] environment: ${env_1.config.nodeEnv}`);
    console.log("---------------------------------------------------------------------------");
    try {
        await (0, mongodb_1.connectDB)();
    }
    catch (err) {
        console.error("[startup] failed to connect to MongoDB", err);
        process.exit(1);
    }
    const app = (0, app_1.createApp)();
    app.listen(env_1.config.port, () => {
        console.log(`[startup] server listening → http://localhost:${env_1.config.port}`);
        console.log(`[startup] control room     → http://localhost:${env_1.config.port}/stylemd`);
    });
    const shutdown = async (signal) => {
        console.log(`[shutdown] received ${signal}, closing server…`);
        await mongoose_1.default.disconnect();
        process.exit(0);
    };
    process.on("SIGTERM", () => void shutdown("SIGTERM"));
    process.on("SIGINT", () => void shutdown("SIGINT"));
}
start().catch((err) => {
    console.error("[startup] fatal error", err);
    process.exit(1);
});
