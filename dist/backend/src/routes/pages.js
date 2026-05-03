"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pagesRouter = void 0;
const express_1 = require("express");
const runManager_1 = require("@/lib/stylemd-artifacts/runManager");
exports.pagesRouter = (0, express_1.Router)();
exports.pagesRouter.get("/", (_req, res) => { res.redirect(302, "/stylemd"); });
exports.pagesRouter.get("/stylemd", (_req, res) => {
    res.render("layout", { title: "StyleMD Lab", description: "Local-first StyleMD control room and artifact pipeline." });
});
exports.pagesRouter.get("/styleguide", (req, res, next) => {
    (async () => {
        const summary = await (0, runManager_1.getLatestStyleMdShowcaseRunSummary)();
        if (!summary || !summary.showcase.available) {
            res.status(404).render("error", { statusCode: 404, message: "No styleguide is available yet. Run an analysis first.", title: "No Styleguide Found" });
            return;
        }
        res.redirect(302, summary.showcase.canonicalUrl);
    })().catch(next);
});
exports.pagesRouter.get("/styleguide/:runId", (req, res) => {
    const { runId } = req.params;
    res.render("styleguide-viewer", { title: `Styleguide — ${runId}`, runId, showcaseSrc: `/styleguide-files/${encodeURIComponent(runId)}/styleguide/showcase.html`, downloadUrl: `/api/stylemd/download-styleguide-v2?runId=${encodeURIComponent(runId)}` });
});
