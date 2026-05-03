import type { Request, Response } from "express";
import { z } from "zod";
import { scrape } from "../services/scraper";
import { ScrapedData } from "../models/ScrapedData";
import { connectMongo } from "@/lib/mongodb";
import { canonicalPageUrl, pageUrlVariantsForLookup } from "@/lib/services/pageUrlCanonical";

const postSchema = z.object({
  url: z.string().url(),
  force: z.boolean().optional().default(false),
});

type ScrapeDoc = { _id: unknown; url: string; title?: string | null; description?: string | null; h1?: string | null; canonical?: string | null; images?: string[]; contentText?: string | null; rawHtml?: string | null };

export async function createScrapedData(req: Request, res: Response): Promise<void> {
  try {
    const { url, force } = postSchema.parse(req.body);
    const canonUrl = canonicalPageUrl(url.trim());
    console.log(`[CONTROLLER] Processing URL: ${canonUrl}, force: ${force}`);
    
    await connectMongo();
    const urlVariants = pageUrlVariantsForLookup(canonUrl);

    if (!force) {
      const cached = urlVariants.length
        ? await ScrapedData.findOne({ url: { $in: urlVariants } }).lean() as ScrapeDoc | null
        : await ScrapedData.findOne({ url: canonUrl }).lean() as ScrapeDoc | null;
      if (cached && cached._id) {
        console.log(`[CONTROLLER] Found cached data, _id: ${cached._id}`);
        res.json({ ok: true, data: cached, cached: true });
        return;
      }
    }
    console.log(`[CONTROLLER] No cache found, calling scrape...`);
    const scraped = await scrape(url.trim());
    if (!scraped) {
      console.error(`[CONTROLLER] Scrape failed for: ${url}`);
      res.status(502).json({ ok: false, error: "Failed to scrape." });
      return;
    }
    const row = {
      ...scraped,
      url: canonUrl,
    };
    console.log(`[CONTROLLER] Scraped data, images: ${row.images.length}, title: ${row.title?.slice(0, 50)}`);

    try {
      const existingScrape = await ScrapedData.findOne({ url: { $in: urlVariants } }).lean() as ScrapeDoc | null;
      let doc: ScrapeDoc | null = null;
      if (existingScrape) {
        console.log(`[CONTROLLER] Updating existing doc, _id: ${existingScrape._id}`);
        doc = await ScrapedData.findOneAndUpdate({ _id: existingScrape._id }, row, { new: true, lean: true }) as ScrapeDoc | null;
      } else {
        console.log(`[CONTROLLER] Creating new doc...`);
        doc = await ScrapedData.create(row).then((d) => d.toObject() as ScrapeDoc);
      }

      const created = Boolean(!existingScrape);
      console.log(`[CONTROLLER] ${created ? "Created" : "Updated"} doc, _id: ${doc?._id}`);
      res.status(created ? 201 : 200).json({ ok: true, data: doc });
    } catch (dbErr: unknown) {
      const err = dbErr as { code?: number };
      if (err.code === 11000) {
        console.log(`[CONTROLLER] Duplicate key, doing upsert...`);
        const updated = await ScrapedData.findOneAndUpdate({ url: canonUrl }, row, { new: true, lean: true, upsert: true });
        res.json({ ok: true, data: updated });
      } else throw dbErr;
    }
  } catch (err) {
    console.error(`[CONTROLLER] Error:`, err);
    res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
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
