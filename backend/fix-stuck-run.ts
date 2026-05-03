const dotenv = require("dotenv");
const path = require("node:path");
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

import mongoose from "mongoose";
import { connectDB, safeWrite } from "../lib/mongodb";
import { StyleMdRun } from "./src/models/StyleMdRun";

async function fixStuckRun() {
  try {
    await connectDB();
    console.log("Connected to MongoDB");

    const runId = "stylemd_1777797529446";
    console.log(`Updating run ${runId} to failed...`);

    const result = await safeWrite(() =>
      StyleMdRun.updateOne(
        { runId },
        { $set: { status: "failed" } }
      )
    );

    console.log("Update result:", result);
    await mongoose.disconnect();
    console.log("Done");
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  }
}

fixStuckRun();
