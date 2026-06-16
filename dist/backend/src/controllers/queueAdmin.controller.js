"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getQueueStats = getQueueStats;
exports.listJobs = listJobs;
exports.getJob = getJob;
exports.retryJob = retryJob;
exports.removeJob = removeJob;
const scrapeQueue_1 = require("../../../lib/queue/scrapeQueue");
// GET /api/admin/queues/stats
async function getQueueStats(_req, res) {
    try {
        const counts = await scrapeQueue_1.scrapeQueue.getJobCounts("waiting", "active", "completed", "failed", "delayed", "paused");
        res.json({ ok: true, queue: scrapeQueue_1.scrapeQueue.name, counts });
    }
    catch (err) {
        res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
}
// GET /api/admin/queues/jobs?state=active&limit=50
// Returns recent jobs in the requested state (one of: waiting|active|completed|failed|delayed)
async function listJobs(req, res) {
    try {
        const state = String(req.query.state || "active");
        const limit = Math.min(parseInt(String(req.query.limit || "20"), 10) || 20, 200);
        const valid = ["waiting", "active", "completed", "failed", "delayed"];
        if (!valid.includes(state)) {
            res.status(400).json({ ok: false, error: `state must be one of ${valid.join(", ")}` });
            return;
        }
        const jobs = await scrapeQueue_1.scrapeQueue.getJobs([state], 0, limit - 1, false);
        const rows = await Promise.all(jobs.map(async (j) => ({
            id: j.id,
            name: j.name,
            state: await j.getState(),
            progress: j.progress,
            attemptsMade: j.attemptsMade,
            data: j.data,
            failedReason: j.failedReason,
            timestamp: j.timestamp,
            processedOn: j.processedOn,
            finishedOn: j.finishedOn,
            returnvalue: j.returnvalue,
        })));
        res.json({ ok: true, state, jobs: rows });
    }
    catch (err) {
        res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
}
// GET /api/admin/jobs/:id
async function getJob(req, res) {
    try {
        const job = await scrapeQueue_1.scrapeQueue.getJob(req.params.id);
        if (!job) {
            res.status(404).json({ ok: false, error: "Job not found" });
            return;
        }
        const state = await job.getState();
        res.json({
            ok: true,
            job: {
                id: job.id,
                name: job.name,
                state,
                progress: job.progress,
                attemptsMade: job.attemptsMade,
                data: job.data,
                returnvalue: job.returnvalue,
                failedReason: job.failedReason,
                timestamp: job.timestamp,
                processedOn: job.processedOn,
                finishedOn: job.finishedOn,
            },
        });
    }
    catch (err) {
        res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
}
// POST /api/admin/jobs/:id/retry
async function retryJob(req, res) {
    try {
        const job = await scrapeQueue_1.scrapeQueue.getJob(req.params.id);
        if (!job) {
            res.status(404).json({ ok: false, error: "Job not found" });
            return;
        }
        await job.retry();
        res.json({ ok: true, jobId: job.id });
    }
    catch (err) {
        res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
}
// DELETE /api/admin/jobs/:id
async function removeJob(req, res) {
    try {
        const job = await scrapeQueue_1.scrapeQueue.getJob(req.params.id);
        if (!job) {
            res.status(404).json({ ok: false, error: "Job not found" });
            return;
        }
        await job.remove();
        res.json({ ok: true, jobId: req.params.id });
    }
    catch (err) {
        res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
}
