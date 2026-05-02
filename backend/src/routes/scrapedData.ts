import { Router } from "express";
import { createScrapedData, listScrapedData } from "../controllers/scrapedData.controller";

export const scrapedDataRouter = Router();

scrapedDataRouter.post("/", (req, res, next) => { createScrapedData(req, res).catch(next); });
scrapedDataRouter.get("/", (req, res, next) => { listScrapedData(req, res).catch(next); });
