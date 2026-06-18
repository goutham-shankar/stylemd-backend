import { Router } from "express";
import { requireAdmin, requireAuth } from "../middleware/requireAdmin";
import {
  getDashboardStats,
  listRuns,
  getRunDetail,
  getRunBySlug,
  deleteRun,
  updateRun,
  bulkUpdateRuns,
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
  listCategories,
  createCategory,
  renameCategory,
  deleteCategory,
} from "../controllers/admin.controller";
import {
  listVoltDesigns,
  createVoltDesign,
  updateVoltDesign,
  deleteVoltDesign,
  listLibraryEntries,
  createLibraryEntry,
  updateLibraryEntry,
  deleteLibraryEntry,
} from "../controllers/voltLibrary.controller";
import {
  getQueueStats,
  listJobs,
  getJob,
  retryJob,
  removeJob,
} from "../controllers/queueAdmin.controller";
import {
  listUsers,
  createUser,
  updateUserRole,
  deleteUser,
  getMe,
} from "../controllers/users.controller";

export const adminRouter = Router();

// /me is accessible to any authenticated user (not just admins).
// Must be registered BEFORE the global requireAdmin middleware.
adminRouter.get("/me", requireAuth, getMe);

adminRouter.use(requireAdmin);

// Dashboard
adminRouter.get("/stats", getDashboardStats);

// Runs
adminRouter.get("/runs", listRuns);
adminRouter.patch("/runs/bulk", bulkUpdateRuns);
adminRouter.get("/runs/by-slug/:slug", getRunBySlug);
adminRouter.get("/runs/by-slug/:slug/html", getRunHtml);
adminRouter.put("/runs/by-slug/:slug/html", updateRunHtml);
adminRouter.get("/runs/:runId", getRunDetail);
adminRouter.patch("/runs/:runId", updateRun);
adminRouter.delete("/runs/:runId", deleteRun);
adminRouter.post("/runs/:runId/rerun", rerunScrape);

// New scrape
adminRouter.post("/scrape", newScrape);

// Categories
adminRouter.get("/categories", listCategories);
adminRouter.post("/categories", createCategory);
adminRouter.patch("/categories/rename", renameCategory);
adminRouter.delete("/categories/:name", deleteCategory);

// Scraped data
adminRouter.get("/scraped", listScraped);
adminRouter.get("/scraped/:id", getScrapedDetail);
adminRouter.patch("/scraped/:id", updateScraped);
adminRouter.delete("/scraped/:id", deleteScraped);

// Raw collection browser
adminRouter.get("/collections", listCollections);
adminRouter.get("/collections/:name", browseCollection);

// Users (/me is already registered above with requireAuth)
adminRouter.get("/users", listUsers);
adminRouter.post("/users", createUser);
adminRouter.patch("/users/:uid/role", updateUserRole);
adminRouter.delete("/users/:uid", deleteUser);

// Volt registry
adminRouter.get("/volt", listVoltDesigns);
adminRouter.post("/volt", createVoltDesign);
adminRouter.patch("/volt/:id", updateVoltDesign);
adminRouter.delete("/volt/:id", deleteVoltDesign);

// Design library
adminRouter.get("/library", listLibraryEntries);
adminRouter.post("/library", createLibraryEntry);
adminRouter.patch("/library/:id", updateLibraryEntry);
adminRouter.delete("/library/:id", deleteLibraryEntry);

// Queue (re-exports from queueAdmin)
adminRouter.get("/queues/stats", getQueueStats);
adminRouter.get("/queues/jobs", listJobs);
adminRouter.get("/jobs/:id", getJob);
adminRouter.post("/jobs/:id/retry", retryJob);
adminRouter.delete("/jobs/:id", removeJob);
