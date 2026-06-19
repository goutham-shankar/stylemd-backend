import { Router } from "express";
import {
  publicScrape,
  publicRunStatus,
  publicListRuns,
  publicMyRuns,
  publicGetRun,
  publicListCategories,
  publicAuthSync,
} from "../controllers/public.controller";

export const publicRouter = Router();

publicRouter.get("/categories", publicListCategories);
publicRouter.post("/auth/sync", publicAuthSync);
publicRouter.post("/scrape", publicScrape);
publicRouter.get("/runs/mine", publicMyRuns);
publicRouter.get("/runs/:slug/status", publicRunStatus);
publicRouter.get("/runs/:slug", publicGetRun);
publicRouter.get("/runs", publicListRuns);
