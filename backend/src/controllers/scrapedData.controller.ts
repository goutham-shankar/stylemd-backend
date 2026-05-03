import type { Request, Response } from "express";
import { z } from "zod";
import { scrape } from "../services/scraper";
import { ScrapedData } from "../models/ScrapedData";
import { connectDB, safeWrite } from "@/lib/mongodb";
import { canonicalPageUrl, pageUrlVariantsForLookup } from "@/lib/services/pageUrlCanonical";
import { isValidScrapedRecord } from "../utils/validation";

// ---------------------------------------------------------------------------
// 1. Receive POST /scraped-data with { url }
// ---------------------------------------------------------------------------
const postSchema = z.object({
  url: z.string().url(),
});

export async function createScrapedData(req: Request, res: Response): Promise<void> {
  try {
    // 🟡 FIX 7: OPTIONAL SAFETY FOR SCRAPE ENDPOINT
    const { url } = req.body as { url?: string };
    if (!url || typeof url !== "string") {
      res.status(400).json({ ok: false, error: "Invalid or missing URL" });
      return;
    }

    postSchema.parse({ url });
    
    // 2. Normalize URL (Strip query params and hashes via canonicalPageUrl)
    const urlNormalized = canonicalPageUrl(url);
    console.log(`[SCRAPE] start url=${urlNormalized}`);



    // 3. Check MongoDB: Use pageUrlVariantsForLookup to catch all variants
    const variants = pageUrlVariantsForLookup(urlNormalized);
    const existing = await ScrapedData.findOne({ url: { $in: variants } }).lean<{ 
      url: string; 
      retryCount?: number;
      images: string[];
      contentText: string;
      rawHtml: string;
    } | null>();
    
    // STRICT validity check: return cached only if valid
    if (existing && isValidScrapedRecord(existing)) {
      console.log(`[SCRAPE] db-hit (valid) url=${urlNormalized}`);
      res.json({ ok: true, data: existing });
      return;
    }

    // 🔴 FIX 3: PREVENT INFINITE RE-SCRAPE LOOP
    if (existing && !isValidScrapedRecord(existing)) {
      const retries = existing.retryCount || 0;
      if (retries >= 2) {
        console.warn(`[SCRAPE] max retries reached for ${urlNormalized}, returning last known data`);
        res.json({ ok: true, data: existing });
        return;
      }
      // 🟠 FIX 6: ADD LOGGING FOR OVERWRITE
      console.log(`[SCRAPE] overwriting invalid record (attempt ${retries + 1}): ${urlNormalized}`);
      
      // Increment retry count before re-scraping to prevent race loops
      await safeWrite(() => ScrapedData.updateOne({ url: existing.url }, { $inc: { retryCount: 1 } }));
    }

    // 4. Else: Run scraper (Playwright)
    console.log(`[SCRAPE] scraping url=${urlNormalized}`);
    const scraped = await scrape(urlNormalized);
    if (!scraped) {
      console.log(`[SCRAPE] error url=${urlNormalized}`);
      res.status(500).json({ ok: false, error: "Failed to scrape URL." });
      return;
    }

    // 🟠 FIX 2: ENFORCE CANONICAL URL IN DB
    // 🟠 FIX 4: ENSURE SINGLE WRITE PATH
    const payload = {
      url: urlNormalized,
      title: scraped.title,
      description: scraped.description,
      h1: scraped.h1,
      canonical: scraped.canonical,
      images: scraped.images,
      contentText: scraped.contentText,
      rawHtml: scraped.rawHtml,
      retryCount: 0, // Reset on success
      createdAt: new Date(),
    };

    await safeWrite(() =>
      ScrapedData.updateOne(
        { url: urlNormalized },
        { $set: payload },
        { upsert: true }
      )
    );

    const doc = await ScrapedData.findOne({ url: urlNormalized }).lean();

    console.log(`[SCRAPE] success url=${urlNormalized}`);

    // Return saved document
    res.status(201).json({ ok: true, data: doc });
  } catch (err) {
    console.log(`[SCRAPE] error url=${req.body?.url ?? "unknown"}`);
    const status = err instanceof z.ZodError ? 400 : 500;
    res.status(status).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

export async function listScrapedData(req: Request, res: Response): Promise<void> {
  try {
    const { url } = req.query as { url?: string };


    if (url) {
      // 🔴 FIX 1: CANONICALIZATION IN GET HANDLER
      const variants = pageUrlVariantsForLookup(canonicalPageUrl(url));
      const doc = await ScrapedData.findOne({ url: { $in: variants } }).lean();
      if (doc) {
        res.json({ ok: true, data: doc });
        return;
      }
      // 🔴 FIX 2: REMOVE HARD 404 IN GET
      res.json({ ok: true, data: null });
      return;
    }

    const data = await ScrapedData.find({}, { rawHtml: 0 }).sort({ createdAt: -1 }).limit(100).lean();
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}
