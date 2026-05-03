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

export async function createScrapedData(req: Request, res: Response): Promise<void> {
  try {
    const { url, force } = postSchema.parse(req.body);
    const canonUrl = canonicalPageUrl(url.trim());
    await connectMongo();
    const urlVariants = pageUrlVariantsForLookup(canonUrl);

    if (!force) {
      const cached =
        urlVariants.length ?
          await ScrapedData.findOne({ url: { $in: urlVariants } }).lean()
        : await ScrapedData.findOne({ url: canonUrl }).lean();
      if (cached) {
        res.json({ ok: true, data: cached, cached: true });
        return;
      }
    }
    const scraped = await scrape(url.trim());
    if (!scraped) {
      res.status(502).json({ ok: false, error: "Failed to scrape." });
      return;
    }
    const row = {
      ...scraped,
      url: canonUrl,
    };

    try {
      type WithId = { _id: unknown } | null;
      const existingScrape = await ScrapedData.findOne({
        url: { $in: urlVariants },
      }).lean() as WithId;
      let doc =
        existingScrape ?
          await ScrapedData.findOneAndUpdate({ _id: existingScrape._id }, row, {
            new: true,
            lean: true,
          })
        : await ScrapedData.create(row).then((d) => d.toObject());

      const created = Boolean(!existingScrape);
      res.status(created ? 201 : 200).json({ ok: true, data: doc });
    } catch (dbErr: any) {
      if (dbErr.code === 11000) {
        const updated = await ScrapedData.findOneAndUpdate(
          { url: canonUrl },
          row,
          { new: true, lean: true, upsert: true },
        );
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
