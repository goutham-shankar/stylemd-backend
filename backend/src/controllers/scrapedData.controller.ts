import type { Request, Response } from "express";
import { z } from "zod";
import { scrape } from "../services/scraper";
import { ScrapedData } from "../models/ScrapedData";
import { connectMongo } from "@/lib/mongodb";
import { canonicalPageUrl, pageUrlVariantsForLookup } from "@/lib/services/pageUrlCanonical";

// ---------------------------------------------------------------------------
// 1. Receive POST /scraped-data with { url }
// ---------------------------------------------------------------------------
const postSchema = z.object({
  url: z.string().url(),
});

export async function createScrapedData(req: Request, res: Response): Promise<void> {
  try {
    const { url } = postSchema.parse(req.body);
    
    // 2. Normalize URL (Strip query params and hashes via canonicalPageUrl)
    const urlNormalized = canonicalPageUrl(url);
    console.log(`[SCRAPE] start url=${urlNormalized}`);

    await connectMongo();

    // 3. Check MongoDB: Use pageUrlVariantsForLookup to catch all variants
    const variants = pageUrlVariantsForLookup(urlNormalized);
    const existing = await ScrapedData.findOne({ url: { $in: variants } }).lean();
    
    if (existing) {
      console.log(`[SCRAPE] db-hit url=${urlNormalized}`);
      res.json({ ok: true, data: existing });
      return;
    }

    // 4. Else: Run scraper (Playwright)
    console.log(`[SCRAPE] scraping url=${urlNormalized}`);
    const scraped = await scrape(urlNormalized);
    if (!scraped) {
      console.log(`[SCRAPE] error url=${urlNormalized}`);
      res.status(500).json({ ok: false, error: "Failed to scrape URL." });
      return;
    }

    // Process images and Save to MongoDB
    const doc = await ScrapedData.create({
      url: urlNormalized,
      title: scraped.title,
      description: scraped.description,
      h1: scraped.h1,
      canonical: scraped.canonical,
      images: scraped.images, // images array is already base64 only
      contentText: scraped.contentText,
      rawHtml: scraped.rawHtml,
      createdAt: new Date(),
    });

    console.log(`[SCRAPE] success url=${urlNormalized}`);

    // Return saved document
    res.status(201).json({ ok: true, data: doc.toObject() });
  } catch (err) {
    console.log(`[SCRAPE] error url=${req.body?.url ?? "unknown"}`);
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

export async function listScrapedData(_req: Request, res: Response): Promise<void> {
  try {
    await connectMongo();
    const data = await ScrapedData.find({}, { rawHtml: 0 }).sort({ createdAt: -1 }).limit(100).lean();
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}
