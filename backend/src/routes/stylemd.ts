import { Router } from "express";
import { runStyleMd, clearCache, getBySlug, listStyleMdRuns, fetchImageAsBase64 } from "../controllers/stylemd.controller";

export const stylemdRouter = Router();

// POST /api/stylemd
// Full pipeline: scrape → extract → generate
stylemdRouter.post("/", (req, res, next) => { runStyleMd(req, res).catch(next); });

// INTERNAL / UNUSED (Clear database cache)
stylemdRouter.delete("/", (req, res, next) => { clearCache(req, res).catch(next); });

// INTERNAL / UNUSED (Fetch local image as base64)
stylemdRouter.post("/fetch-image", (req, res, next) => { fetchImageAsBase64(req, res).catch(next); });

// GET /api/stylemd/by-slug/:slug
// Lookup a run by its human-readable slug (or runId for backwards compat)
stylemdRouter.get("/by-slug/:slug", (req, res, next) => { getBySlug(req, res).catch(next); });

// GET /api/stylemd/runs
// List all completed runs (for the library page)
stylemdRouter.get("/runs", (req, res, next) => { listStyleMdRuns(req, res).catch(next); });
