"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startRun = startRun;
exports.cancelRun = cancelRun;
exports.getRunSummary = getRunSummary;
exports.listRuns = listRuns;
const zod_1 = require("zod");
const provider_1 = require("../../../lib/stylemd-artifacts/provider");
const runManager_1 = require("../../../lib/stylemd-artifacts/runManager");
const startRunSchema = zod_1.z.object({
    url: zod_1.z.string().url(),
    provider: zod_1.z.enum(["claude", "kimi"]).optional().default("kimi"),
});
async function startRun(req, res) {
    try {
        const { url, provider } = startRunSchema.parse(req.body);
        const credentialError = (0, provider_1.validateStyleMdProviderCredentials)(provider);
        if (credentialError) {
            res.status(400).json({ ok: false, error: credentialError });
            return;
        }
        const activeRunId = (0, runManager_1.getActiveStyleMdRunId)();
        if (activeRunId) {
            res.status(409).json({ ok: false, error: `Run active: ${activeRunId}` });
            return;
        }
        const { runId } = await (0, runManager_1.startStyleMdRun)(url, provider);
        res.json({ ok: true, runId });
    }
    catch (err) {
        res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
}
async function cancelRun(_req, res) {
    try {
        const result = await (0, runManager_1.cancelActiveStyleMdRun)();
        res.json({ ok: true, ...result });
    }
    catch (err) {
        res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
}
async function getRunSummary(req, res) {
    try {
        const summary = await (0, runManager_1.getStyleMdRunSummary)(req.params.runId);
        if (!summary) {
            res.status(404).json({ ok: false, error: "Run not found." });
            return;
        }
        res.json({ ok: true, summary });
    }
    catch (err) {
        res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
}
async function listRuns(_req, res) {
    try {
        const summaries = await (0, runManager_1.listStyleMdRunSummaries)();
        res.json({ ok: true, summaries });
    }
    catch (err) {
        res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
}
