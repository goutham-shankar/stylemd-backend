"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createScrapedData = createScrapedData;
exports.listScrapedData = listScrapedData;
const zod_1 = require("zod");
const scraper_1 = require("../services/scraper");
const ScrapedData_1 = require("../models/ScrapedData");
const mongodb_1 = require("@/lib/mongodb");
const postSchema = zod_1.z.object({
    url: zod_1.z.string().url(),
    force: zod_1.z.boolean().optional().default(false),
});
async function createScrapedData(req, res) {
    try {
        const { url, force } = postSchema.parse(req.body);
        await (0, mongodb_1.connectMongo)();
        if (!force) {
            const cached = await ScrapedData_1.ScrapedData.findOne({ url }).lean();
            if (cached) {
                res.json({ ok: true, data: cached, cached: true });
                return;
            }
        }
        const scraped = await (0, scraper_1.scrape)(url);
        if (!scraped) {
            res.status(502).json({ ok: false, error: "Failed to scrape." });
            return;
        }
        try {
            const doc = await ScrapedData_1.ScrapedData.create(scraped);
            res.status(201).json({ ok: true, data: doc });
        }
        catch (dbErr) {
            if (dbErr.code === 11000) {
                const updated = await ScrapedData_1.ScrapedData.findOneAndUpdate({ url }, scraped, { new: true, lean: true });
                res.json({ ok: true, data: updated });
            }
            else
                throw dbErr;
        }
    }
    catch (err) {
        res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
}
async function listScrapedData(_req, res) {
    try {
        await (0, mongodb_1.connectMongo)();
        const data = await ScrapedData_1.ScrapedData.find({}, { rawHtml: 0 }).sort({ createdAt: -1 }).limit(100).lean();
        res.json({ ok: true, data });
    }
    catch (err) {
        res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
}
