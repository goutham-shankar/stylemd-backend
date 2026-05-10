import { persistStyleMdAfterGeneration } from "./lib/services/persistStyleMdMongo";
import { ScrapedData } from "./backend/src/models/ScrapedData";
import { StyleMdRun } from "./backend/src/models/StyleMdRun";
import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: "backend/.env.local" });

import { connectDB } from "./lib/mongodb";

async function run() {
  await connectDB();
  console.log("=== Testing Pipeline Storage ===");
  
  // 1. Run the storage pipeline. This will internally trigger the scraper.
  const url = "https://drinkghia.com/";
  await persistStyleMdAfterGeneration({
    url,
    runId: "test_run_ghia_123",
    provider: "kimi",
    model: "test_model",
    styleMd: "Test StyleMD content for Ghia",
    screenshotUrl: "/styleguide-files/test_run_ghia_123/full_screenshot.png",
    screenshot: "", 
  });
  
  // 2. Query MongoDB to verify fields are populated
  console.log("\n=== Verifying MongoDB Storage ===");
  const scrapedDoc = await ScrapedData.findOne({ url }).lean();
  
  if (scrapedDoc) {
    console.log("Found ScrapedData document!");
    console.log(`- Title: ${scrapedDoc.title}`);
    console.log(`- Description: ${scrapedDoc.description?.substring(0, 50)}...`);
    console.log(`- H1: ${scrapedDoc.h1}`);
    console.log(`- Canonical: ${scrapedDoc.canonical}`);
    console.log(`- Images Array Length: ${scrapedDoc.images?.length}`);
    if (scrapedDoc.images && scrapedDoc.images.length > 0) {
        console.log(`- First Image: ${scrapedDoc.images[0]}`);
    }
  } else {
    console.log("ScrapedData document not found!");
  }
  
  await mongoose.disconnect();
}

run().catch(console.error);
