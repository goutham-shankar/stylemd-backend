import { Router } from "express";
import {
  publicScrape,
  publicRunStatus,
  publicListRuns,
  publicMyRuns,
  publicGetRun,
} from "../controllers/public.controller";

export const publicRouter = Router();

publicRouter.post("/scrape", publicScrape);
publicRouter.get("/runs/mine", publicMyRuns);
publicRouter.get("/runs/:slug/status", publicRunStatus);
publicRouter.get("/runs/:slug", publicGetRun);
publicRouter.get("/runs", publicListRuns);
