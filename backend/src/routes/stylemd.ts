import { Router } from "express";
import { runStyleMd, clearCache, getBySlug, listStyleMdRuns } from "../controllers/stylemd.controller";

export const stylemdRouter = Router();

// Simplified pipeline – POST to run, DELETE to clear cache
stylemdRouter.post("/", (req, res, next) => { runStyleMd(req, res).catch(next); });
stylemdRouter.delete("/", (req, res, next) => { clearCache(req, res).catch(next); });

// Lookup a run by its human-readable slug (or runId for backwards compat)
stylemdRouter.get("/by-slug/:slug", (req, res, next) => { getBySlug(req, res).catch(next); });

// List all completed runs (for the library page)
stylemdRouter.get("/runs", (req, res, next) => { listStyleMdRuns(req, res).catch(next); });
