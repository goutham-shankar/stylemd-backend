/**
 * Backend entry point.
 */
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../../lib/mongodb";
import { createApp } from "./app";
import { config } from "./config/env";

async function start(): Promise<void> {
  console.log("---------------------------------------------------------------------------");
  console.log(`[startup] BUILD_ID: ${Date.now()}`); // Detect stale PM2 dist code
  console.log(`[startup] booting Design Probe backend on port ${config.port}`);
  console.log(`[startup] environment: ${config.nodeEnv}`);
  console.log("---------------------------------------------------------------------------");

  try {
    await connectDB();
  } catch (err) {
    console.error("[startup] failed to connect to MongoDB", err);
    process.exit(1);
  }

  const app = createApp();

  app.listen(config.port, () => {
    console.log(`[startup] server listening → http://localhost:${config.port}`);
    console.log(`[startup] control room     → http://localhost:${config.port}/stylemd`);
  });

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[shutdown] received ${signal}, closing server…`);
    await mongoose.disconnect();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

start().catch((err) => {
  console.error("[startup] fatal error", err);
  process.exit(1);
});
