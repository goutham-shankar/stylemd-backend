#!/usr/bin/env tsx
/**
 * scripts/apply-indexes.ts
 *
 * Ensures all indexes declared in the Mongoose schemas exist in MongoDB.
 * Safe to run repeatedly — Mongoose's syncIndexes() creates missing ones
 * and drops orphaned ones for each model.
 *
 * Usage:
 *     tsx scripts/apply-indexes.ts
 */
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../lib/mongodb";
import { ScrapedData } from "../backend/src/models/ScrapedData";
import { StyleMdRun } from "../backend/src/models/StyleMdRun";

async function main(): Promise<void> {
  await connectDB();

  console.log("── syncing indexes ──");
  for (const [name, model] of [
    ["ScrapedData", ScrapedData],
    ["StyleMdRun", StyleMdRun],
  ] as const) {
    const before = await model.collection.indexes();
    await model.syncIndexes();
    const after = await model.collection.indexes();
    console.log(`\n${name} (collection: ${model.collection.collectionName}):`);
    console.log("  before:", before.map((i) => i.name).join(", "));
    console.log("  after: ", after.map((i) => i.name).join(", "));
  }

  await mongoose.disconnect();
  console.log("\ndone.");
}

main().catch((err) => {
  console.error("index sync failed:", err);
  process.exit(1);
});
