import { Router } from "express";
import { createScrapedData, listScrapedData } from "../controllers/scrapedData.controller";

export const scrapedDataRouter = Router();

// POST /api/scraped-data
// Scrape-only endpoint (idempotent, cache-aware)
scrapedDataRouter.post("/", (req, res, next) => { createScrapedData(req, res).catch(next); });

// GET /api/scraped-data?url=
// Read-only fetch (never triggers scrape)
scrapedDataRouter.get("/", (req, res, next) => { listScrapedData(req, res).catch(next); });
