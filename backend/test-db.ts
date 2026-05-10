import "dotenv/config";
import mongoose from "mongoose";
import { connectDB, safeWrite } from "../lib/mongodb";
import { StyleMdRun } from "./src/models/StyleMdRun";

async function test() {
  try {
    console.log("Connecting...");
    await connectDB();
    console.log("Connected! ReadyState:", mongoose.connection.readyState);

    console.log("Creating run...");
    const result = await safeWrite(() =>
      StyleMdRun.create({
        url: "https://test.com/db-test",
        slug: "db-test-" + Date.now(),
        provider: "kimi",
        status: "completed",
      })
    );
    console.log("Saved!", result);

    await mongoose.disconnect();
  } catch (err) {
    console.error("Error:", err);
  }
}

test();
