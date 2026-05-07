"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stylemdRouter = void 0;
const express_1 = require("express");
const stylemd_controller_1 = require("../controllers/stylemd.controller");
exports.stylemdRouter = (0, express_1.Router)();
// POST /api/stylemd
// Full pipeline: scrape → extract → generate
exports.stylemdRouter.post("/", (req, res, next) => { (0, stylemd_controller_1.runStyleMd)(req, res).catch(next); });
// INTERNAL / UNUSED (Clear database cache)
exports.stylemdRouter.delete("/", (req, res, next) => { (0, stylemd_controller_1.clearCache)(req, res).catch(next); });
// INTERNAL / UNUSED (Fetch local image as base64)
exports.stylemdRouter.post("/fetch-image", (req, res, next) => { (0, stylemd_controller_1.fetchImageAsBase64)(req, res).catch(next); });
// GET /api/stylemd/by-slug/:slug
// Lookup a run by its human-readable slug (or runId for backwards compat)
exports.stylemdRouter.get("/by-slug/:slug", (req, res, next) => { (0, stylemd_controller_1.getBySlug)(req, res).catch(next); });
// GET /api/stylemd/runs
// List all completed runs (for the library page)
exports.stylemdRouter.get("/runs", (req, res, next) => { (0, stylemd_controller_1.listStyleMdRuns)(req, res).catch(next); });
