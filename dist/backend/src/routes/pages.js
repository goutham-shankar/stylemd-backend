"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pagesRouter = void 0;
const express_1 = require("express");
const StyleMdRun_1 = require("../models/StyleMdRun");
exports.pagesRouter = (0, express_1.Router)();
exports.pagesRouter.get("/", (_req, res) => { res.redirect(302, "/stylemd"); });
exports.pagesRouter.get("/stylemd", (_req, res) => {
    res.render("layout", { title: "StyleMD Lab", description: "Local-first StyleMD control room and artifact pipeline." });
});
exports.pagesRouter.get("/styleguide", (req, res, next) => {
    (async () => {
        // Find the latest completed run
        const latest = await StyleMdRun_1.StyleMdRun.findOne({
            status: { $in: ["completed", "completed_with_warnings"] },
            runId: { $ne: null }
        }).sort({ createdAt: -1 }).lean();
        if (!latest || !latest.runId) {
            res.status(404).render("error", {
                statusCode: 404,
                message: "No styleguide is available yet. Run an analysis first.",
                title: "No Styleguide Found"
            });
            return;
        }
        // Redirect to the latest run's styleguide viewer
        res.redirect(302, `/styleguide/${latest.runId}`);
    })().catch(next);
});
exports.pagesRouter.get("/styleguide/:runId", (req, res) => {
    const { runId } = req.params;
    res.render("styleguide-viewer", {
        title: `Styleguide — ${runId}`,
        runId,
        showcaseSrc: `/styleguide-files/${encodeURIComponent(runId)}/styleguide/showcase.html`,
        downloadUrl: `/api/stylemd/download-styleguide-v2?runId=${encodeURIComponent(runId)}`
    });
});
