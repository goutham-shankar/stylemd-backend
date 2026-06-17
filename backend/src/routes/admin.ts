import { Router } from "express";
import { requireAdmin } from "../middleware/requireAdmin";
import {
  getDashboardStats,
  listRuns,
  getRunDetail,
  getRunBySlug,
  deleteRun,
  updateRun,
  rerunScrape,
  newScrape,
  getRunHtml,
  updateRunHtml,
  listScraped,
  getScrapedDetail,
  deleteScraped,
  updateScraped,
  listCollections,
  browseCollection,
} from "../controllers/admin.controller";
import {
  getQueueStats,
  listJobs,
  getJob,
  retryJob,
  removeJob,
} from "../controllers/queueAdmin.controller";

export const adminRouter = Router();

adminRouter.use(requireAdmin);

// Dashboard
adminRouter.get("/stats", getDashboardStats);

// Runs
adminRouter.get("/runs", listRuns);
adminRouter.get("/runs/by-slug/:slug", getRunBySlug);
adminRouter.get("/runs/by-slug/:slug/html", getRunHtml);
adminRouter.put("/runs/by-slug/:slug/html", updateRunHtml);
adminRouter.get("/runs/:runId", getRunDetail);
adminRouter.patch("/runs/:runId", updateRun);
adminRouter.delete("/runs/:runId", deleteRun);
adminRouter.post("/runs/:runId/rerun", rerunScrape);

// New scrape
adminRouter.post("/scrape", newScrape);

// Scraped data
adminRouter.get("/scraped", listScraped);
adminRouter.get("/scraped/:id", getScrapedDetail);
adminRouter.patch("/scraped/:id", updateScraped);
adminRouter.delete("/scraped/:id", deleteScraped);

// Raw collection browser
adminRouter.get("/collections", listCollections);
adminRouter.get("/collections/:name", browseCollection);

// Queue (re-exports from queueAdmin)
adminRouter.get("/queues/stats", getQueueStats);
adminRouter.get("/queues/jobs", listJobs);
adminRouter.get("/jobs/:id", getJob);
adminRouter.post("/jobs/:id/retry", retryJob);
adminRouter.delete("/jobs/:id", removeJob);
