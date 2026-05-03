"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stylemdRouter = void 0;
const express_1 = require("express");
const stylemd_controller_1 = require("../controllers/stylemd.controller");
exports.stylemdRouter = (0, express_1.Router)();
// Simplified pipeline – POST to run, DELETE to clear cache
exports.stylemdRouter.post("/", (req, res, next) => { (0, stylemd_controller_1.runStyleMd)(req, res).catch(next); });
exports.stylemdRouter.delete("/", (req, res, next) => { (0, stylemd_controller_1.clearCache)(req, res).catch(next); });
// Lookup a run by its human-readable slug (or runId for backwards compat)
exports.stylemdRouter.get("/by-slug/:slug", (req, res, next) => { (0, stylemd_controller_1.getBySlug)(req, res).catch(next); });
// List all completed runs (for the library page)
exports.stylemdRouter.get("/runs", (req, res, next) => { (0, stylemd_controller_1.listStyleMdRuns)(req, res).catch(next); });
