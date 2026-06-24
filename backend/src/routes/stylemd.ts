import { Router } from "express";
import { runStyleMd, getBySlug, listStyleMdRuns } from "../controllers/stylemd.controller";
import { requireAdmin } from "../middleware/requireAdmin";

export const stylemdRouter = Router();

// POST /api/stylemd
stylemdRouter.post("/", (req, res, next) => { runStyleMd(req, res).catch(next); });

// GET /api/stylemd/by-slug/:slug
stylemdRouter.get("/by-slug/:slug", (req, res, next) => { getBySlug(req, res).catch(next); });

// GET /api/stylemd/runs — admin only
stylemdRouter.get("/runs", requireAdmin, (req, res, next) => { listStyleMdRuns(req, res).catch(next); });
