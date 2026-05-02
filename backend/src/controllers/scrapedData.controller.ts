import type { Request, Response } from "express";
import { z } from "zod";
import { scrape } from "../services/scraper";
import { ScrapedData } from "../models/ScrapedData";
import { connectMongo } from "@/lib/mongodb";

const postSchema = z.object({
  url: z.string().url(),
  force: z.boolean().optional().default(false),
});

export async function createScrapedData(req: Request, res: Response): Promise<void> {
  try {
    const { url, force } = postSchema.parse(req.body);
    await connectMongo();
    if (!force) {
      const cached = await ScrapedData.findOne({ url }).lean();
      if (cached) {
        res.json({ ok: true, data: cached, cached: true });
        return;
      }
    }
    const scraped = await scrape(url);
    if (!scraped) {
      res.status(502).json({ ok: false, error: "Failed to scrape." });
      return;
    }
    try {
      const doc = await ScrapedData.create(scraped);
      res.status(201).json({ ok: true, data: doc });
    } catch (dbErr: any) {
      if (dbErr.code === 11000) {
        const updated = await ScrapedData.findOneAndUpdate({ url }, scraped, { new: true, lean: true });
        res.json({ ok: true, data: updated });
      } else throw dbErr;
    }
  } catch (err) {
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
