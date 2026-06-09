"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createScrapedData = createScrapedData;
exports.listScrapedData = listScrapedData;
const zod_1 = require("zod");
const scraper_1 = require("../services/scraper");
const ScrapedData_1 = require("../models/ScrapedData");
const mongodb_1 = require("../../../lib/mongodb");
const pageUrlCanonical_1 = require("../../../lib/services/pageUrlCanonical");
const validation_1 = require("../utils/validation");
// ---------------------------------------------------------------------------
// 1. Receive POST /scraped-data with { url }
// ---------------------------------------------------------------------------
const postSchema = zod_1.z.object({
    url: zod_1.z.string().url(),
});
async function createScrapedData(req, res) {
    try {
        // 🟡 FIX 7: OPTIONAL SAFETY FOR SCRAPE ENDPOINT
        const { url } = req.body;
        if (!url || typeof url !== "string") {
            res.status(400).json({ ok: false, error: "Invalid or missing URL" });
            return;
        }
        postSchema.parse({ url });
        // 2. Normalize URL (Strip query params and hashes via canonicalPageUrl)
        const urlNormalized = (0, pageUrlCanonical_1.canonicalPageUrl)(url);
        console.log(`[SCRAPE] start url=${urlNormalized}`);
        // 3. Check MongoDB: Use pageUrlVariantsForLookup to catch all variants
        const variants = (0, pageUrlCanonical_1.pageUrlVariantsForLookup)(urlNormalized);
        const existing = await ScrapedData_1.ScrapedData.findOne({ url: { $in: variants } }).lean();
        // STRICT validity check: return cached only if valid
        if (existing && (0, validation_1.isValidScrapedRecord)(existing)) {
            console.log(`[SCRAPE] db-hit (valid) url=${urlNormalized}`);
            res.json({ ok: true, data: existing });
            return;
        }
        // 🔴 FIX 3: PREVENT INFINITE RE-SCRAPE LOOP
        if (existing && !(0, validation_1.isValidScrapedRecord)(existing)) {
            const retries = existing.retryCount || 0;
            if (retries >= 2) {
                console.warn(`[SCRAPE] max retries reached for ${urlNormalized}, returning last known data`);
                res.json({ ok: true, data: existing });
                return;
            }
            // 🟠 FIX 6: ADD LOGGING FOR OVERWRITE
            console.log(`[SCRAPE] overwriting invalid record (attempt ${retries + 1}): ${urlNormalized}`);
            // Increment retry count before re-scraping to prevent race loops
            await (0, mongodb_1.safeWrite)(() => ScrapedData_1.ScrapedData.updateOne({ url: existing.url }, { $inc: { retryCount: 1 } }));
        }
        // 4. Else: Run scraper (Playwright)
        console.log(`[SCRAPE] scraping url=${urlNormalized}`);
        const scraped = await (0, scraper_1.scrape)(urlNormalized);
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
        await (0, mongodb_1.safeWrite)(() => ScrapedData_1.ScrapedData.updateOne({ url: urlNormalized }, { $set: payload }, { upsert: true }));
        const doc = await ScrapedData_1.ScrapedData.findOne({ url: urlNormalized }).lean();
        console.log(`[SCRAPE] success url=${urlNormalized}`);
        // Return saved document
        res.status(201).json({ ok: true, data: doc });
    }
    catch (err) {
        console.log(`[SCRAPE] error url=${req.body?.url ?? "unknown"}`);
        const status = err instanceof zod_1.z.ZodError ? 400 : 500;
        res.status(status).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
}
async function listScrapedData(req, res) {
    try {
        const { url } = req.query;
        if (url) {
            // 🔴 FIX 1: CANONICALIZATION IN GET HANDLER
            const variants = (0, pageUrlCanonical_1.pageUrlVariantsForLookup)((0, pageUrlCanonical_1.canonicalPageUrl)(url));
            const doc = await ScrapedData_1.ScrapedData.findOne({ url: { $in: variants } }).lean();
            if (doc) {
                res.json({ ok: true, data: doc });
                return;
            }
            // 🔴 FIX 2: REMOVE HARD 404 IN GET
            res.json({ ok: true, data: null });
            return;
        }
        const data = await ScrapedData_1.ScrapedData.find({}, { rawHtml: 0 }).sort({ createdAt: -1 }).limit(100).lean();
        res.json({ ok: true, data });
    }
    catch (err) {
        res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
}
