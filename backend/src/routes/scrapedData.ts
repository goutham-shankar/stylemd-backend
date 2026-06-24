import { Router } from "express";
import { createScrapedData, listScrapedData } from "../controllers/scrapedData.controller";
import { requireAdmin } from "../middleware/requireAdmin";

export const scrapedDataRouter = Router();

// POST /api/scraped-data
scrapedDataRouter.post("/", (req, res, next) => { createScrapedData(req, res).catch(next); });

// GET /api/scraped-data?url=
scrapedDataRouter.get("/", requireAdmin, (req, res, next) => { listScrapedData(req, res).catch(next); });
