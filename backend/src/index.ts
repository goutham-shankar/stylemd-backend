/**
 * Backend entry point.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const dotenv = require("dotenv") as typeof import("dotenv");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("node:path") as typeof import("node:path");

dotenv.config({ path: path.resolve(__dirname, "../.env.local") });
dotenv.config({ path: path.resolve(__dirname, "../../.env.local") });

import mongoose from "mongoose";
import { connectDB } from "../../lib/mongodb";
import { createApp } from "./app";
import { config } from "./config/env";

async function start(): Promise<void> {
  console.log(`[startup] booting StyleMD standalone backend on port ${config.port}`);
  console.log(`[startup] environment: ${config.nodeEnv}`);

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
