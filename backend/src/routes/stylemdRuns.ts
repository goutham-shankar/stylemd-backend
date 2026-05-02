import { Router } from "express";
import { startRun, cancelRun, getRunSummary, listRuns } from "../controllers/stylemdRuns.controller";

export const stylemdRunsRouter = Router();

stylemdRunsRouter.post("/run", (req, res, next) => { startRun(req, res).catch(next); });
stylemdRunsRouter.post("/cancel", (req, res, next) => { cancelRun(req, res).catch(next); });
stylemdRunsRouter.get("/runs", (req, res, next) => { listRuns(req, res).catch(next); });
stylemdRunsRouter.get("/runs/:runId", (req, res, next) => { getRunSummary(req, res).catch(next); });
