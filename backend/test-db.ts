const dotenv = require("dotenv");
const path = require("node:path");
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });
dotenv.config({ path: path.resolve(__dirname, "../../.env.local") });
import mongoose from "mongoose";
import { connectMongo } from "../lib/mongodb";
import { StyleMdRun } from "./src/models/StyleMdRun";

async function test() {
  try {
    console.log("Connecting...");
    await connectMongo();
    console.log("Connected! ReadyState:", mongoose.connection.readyState);

    console.log("Creating run...");
    const result = await StyleMdRun.create({
      url: "https://test.com/db-test",
      slug: "db-test-" + Date.now(),
      provider: "kimi",
      status: "completed",
    });
    console.log("Saved!", result);

    await mongoose.disconnect();
  } catch (err) {
    console.error("Error:", err);
  }
}

test();
