import { Router } from "express";
import { getQueueStats, listJobs, getJob, retryJob, removeJob } from "../controllers/queueAdmin.controller";
import { requireAdmin } from "../middleware/requireAdmin";

export const queueAdminRouter = Router();

queueAdminRouter.use(requireAdmin);
queueAdminRouter.get("/queues/stats", getQueueStats);
queueAdminRouter.get("/queues/jobs", listJobs);
queueAdminRouter.get("/jobs/:id", getJob);
queueAdminRouter.post("/jobs/:id/retry", retryJob);
queueAdminRouter.delete("/jobs/:id", removeJob);
