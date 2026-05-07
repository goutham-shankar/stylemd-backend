"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Backend entry point.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const dotenv = require("dotenv");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("node:path");
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });
dotenv.config({ path: path.resolve(__dirname, "../../.env.local") });
// Support running from project root (standard for PM2/production)
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config({ path: path.resolve(process.cwd(), "backend/.env.local") });
const mongoose_1 = __importDefault(require("mongoose"));
const mongodb_1 = require("../../lib/mongodb");
const app_1 = require("./app");
const env_1 = require("./config/env");
async function start() {
    console.log(`[startup] booting StyleMD standalone backend on port ${env_1.config.port}`);
    console.log(`[startup] environment: ${env_1.config.nodeEnv}`);
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
