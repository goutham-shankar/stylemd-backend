"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminRouter = void 0;
const express_1 = require("express");
const requireAdmin_1 = require("../middleware/requireAdmin");
const admin_controller_1 = require("../controllers/admin.controller");
const queueAdmin_controller_1 = require("../controllers/queueAdmin.controller");
exports.adminRouter = (0, express_1.Router)();
exports.adminRouter.use(requireAdmin_1.requireAdmin);
// Dashboard
exports.adminRouter.get("/stats", admin_controller_1.getDashboardStats);
// Runs
exports.adminRouter.get("/runs", admin_controller_1.listRuns);
exports.adminRouter.get("/runs/:runId", admin_controller_1.getRunDetail);
exports.adminRouter.delete("/runs/:runId", admin_controller_1.deleteRun);
// Scraped data
exports.adminRouter.get("/scraped", admin_controller_1.listScraped);
exports.adminRouter.get("/scraped/:id", admin_controller_1.getScrapedDetail);
exports.adminRouter.delete("/scraped/:id", admin_controller_1.deleteScraped);
// Raw collection browser
exports.adminRouter.get("/collections", admin_controller_1.listCollections);
exports.adminRouter.get("/collections/:name", admin_controller_1.browseCollection);
// Queue (re-exports from queueAdmin)
exports.adminRouter.get("/queues/stats", queueAdmin_controller_1.getQueueStats);
exports.adminRouter.get("/queues/jobs", queueAdmin_controller_1.listJobs);
exports.adminRouter.get("/jobs/:id", queueAdmin_controller_1.getJob);
exports.adminRouter.post("/jobs/:id/retry", queueAdmin_controller_1.retryJob);
exports.adminRouter.delete("/jobs/:id", queueAdmin_controller_1.removeJob);
