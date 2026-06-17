"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminRouter = void 0;
const express_1 = require("express");
const requireAdmin_1 = require("../middleware/requireAdmin");
const admin_controller_1 = require("../controllers/admin.controller");
const queueAdmin_controller_1 = require("../controllers/queueAdmin.controller");
const users_controller_1 = require("../controllers/users.controller");
exports.adminRouter = (0, express_1.Router)();
// /me is accessible to any authenticated user (not just admins).
// Must be registered BEFORE the global requireAdmin middleware.
exports.adminRouter.get("/me", requireAdmin_1.requireAuth, users_controller_1.getMe);
exports.adminRouter.use(requireAdmin_1.requireAdmin);
// Dashboard
exports.adminRouter.get("/stats", admin_controller_1.getDashboardStats);
// Runs
exports.adminRouter.get("/runs", admin_controller_1.listRuns);
exports.adminRouter.get("/runs/by-slug/:slug", admin_controller_1.getRunBySlug);
exports.adminRouter.get("/runs/by-slug/:slug/html", admin_controller_1.getRunHtml);
exports.adminRouter.put("/runs/by-slug/:slug/html", admin_controller_1.updateRunHtml);
exports.adminRouter.get("/runs/:runId", admin_controller_1.getRunDetail);
exports.adminRouter.patch("/runs/:runId", admin_controller_1.updateRun);
exports.adminRouter.delete("/runs/:runId", admin_controller_1.deleteRun);
exports.adminRouter.post("/runs/:runId/rerun", admin_controller_1.rerunScrape);
// New scrape
exports.adminRouter.post("/scrape", admin_controller_1.newScrape);
// Categories
exports.adminRouter.get("/categories", admin_controller_1.listCategories);
exports.adminRouter.patch("/categories/rename", admin_controller_1.renameCategory);
exports.adminRouter.delete("/categories/:name", admin_controller_1.deleteCategory);
// Scraped data
exports.adminRouter.get("/scraped", admin_controller_1.listScraped);
exports.adminRouter.get("/scraped/:id", admin_controller_1.getScrapedDetail);
exports.adminRouter.patch("/scraped/:id", admin_controller_1.updateScraped);
exports.adminRouter.delete("/scraped/:id", admin_controller_1.deleteScraped);
// Raw collection browser
exports.adminRouter.get("/collections", admin_controller_1.listCollections);
exports.adminRouter.get("/collections/:name", admin_controller_1.browseCollection);
// Users (/me is already registered above with requireAuth)
exports.adminRouter.get("/users", users_controller_1.listUsers);
exports.adminRouter.post("/users", users_controller_1.createUser);
exports.adminRouter.patch("/users/:uid/role", users_controller_1.updateUserRole);
exports.adminRouter.delete("/users/:uid", users_controller_1.deleteUser);
// Queue (re-exports from queueAdmin)
exports.adminRouter.get("/queues/stats", queueAdmin_controller_1.getQueueStats);
exports.adminRouter.get("/queues/jobs", queueAdmin_controller_1.listJobs);
exports.adminRouter.get("/jobs/:id", queueAdmin_controller_1.getJob);
exports.adminRouter.post("/jobs/:id/retry", queueAdmin_controller_1.retryJob);
exports.adminRouter.delete("/jobs/:id", queueAdmin_controller_1.removeJob);
