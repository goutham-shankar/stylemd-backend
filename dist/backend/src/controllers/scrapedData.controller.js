"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createScrapedData = createScrapedData;
exports.listScrapedData = listScrapedData;
const zod_1 = require("zod");
const scraper_1 = require("../services/scraper");
const ScrapedData_1 = require("../models/ScrapedData");
const mongodb_1 = require("@/lib/mongodb");
const pageUrlCanonical_1 = require("@/lib/services/pageUrlCanonical");
const postSchema = zod_1.z.object({
    url: zod_1.z.string().url(),
    force: zod_1.z.boolean().optional().default(false),
});
async function createScrapedData(req, res) {
    try {
        const { url, force } = postSchema.parse(req.body);
        const canonUrl = (0, pageUrlCanonical_1.canonicalPageUrl)(url.trim());
        console.log(`[CONTROLLER] Processing URL: ${canonUrl}, force: ${force}`);
        await (0, mongodb_1.connectMongo)();
        const urlVariants = (0, pageUrlCanonical_1.pageUrlVariantsForLookup)(canonUrl);
        if (!force) {
            const cached = urlVariants.length
                ? await ScrapedData_1.ScrapedData.findOne({ url: { $in: urlVariants } }).lean()
                : await ScrapedData_1.ScrapedData.findOne({ url: canonUrl }).lean();
            if (cached && cached._id) {
                console.log(`[CONTROLLER] Found cached data, _id: ${cached._id}`);
                res.json({ ok: true, data: cached, cached: true });
                return;
            }
        }
        console.log(`[CONTROLLER] No cache found, calling scrape...`);
        const scraped = await (0, scraper_1.scrape)(url.trim());
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
            const existingScrape = await ScrapedData_1.ScrapedData.findOne({ url: { $in: urlVariants } }).lean();
            let doc = null;
            if (existingScrape) {
                console.log(`[CONTROLLER] Updating existing doc, _id: ${existingScrape._id}`);
                doc = await ScrapedData_1.ScrapedData.findOneAndUpdate({ _id: existingScrape._id }, row, { new: true, lean: true });
            }
            else {
                console.log(`[CONTROLLER] Creating new doc...`);
                doc = await ScrapedData_1.ScrapedData.create(row).then((d) => d.toObject());
            }
            const created = Boolean(!existingScrape);
            console.log(`[CONTROLLER] ${created ? "Created" : "Updated"} doc, _id: ${doc?._id}`);
            res.status(created ? 201 : 200).json({ ok: true, data: doc });
        }
        catch (dbErr) {
            const err = dbErr;
            if (err.code === 11000) {
                console.log(`[CONTROLLER] Duplicate key, doing upsert...`);
                const updated = await ScrapedData_1.ScrapedData.findOneAndUpdate({ url: canonUrl }, row, { new: true, lean: true, upsert: true });
                res.json({ ok: true, data: updated });
            }
            else
                throw dbErr;
        }
    }
    catch (err) {
        console.error(`[CONTROLLER] Error:`, err);
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
