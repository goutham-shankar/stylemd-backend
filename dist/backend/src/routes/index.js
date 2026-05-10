"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const session_1 = require("./session");
const artifacts_1 = require("./artifacts");
const stylemd_1 = require("./stylemd");
const scrapedData_1 = require("./scrapedData");
const download_1 = require("./download");
const pages_1 = require("./pages");
exports.router = (0, express_1.Router)();
exports.router.get("/health", (_req, res) => {
    res.json({ ok: true, status: "running" });
});
exports.router.use("/api/session", session_1.sessionRouter);
exports.router.use("/api/stylemd-artifacts", artifacts_1.artifactsRouter);
exports.router.use("/api/stylemd", stylemd_1.stylemdRouter);
exports.router.use("/api/stylemd", download_1.downloadRouter);
exports.router.use("/api/scraped-data", scrapedData_1.scrapedDataRouter);
exports.router.use("/", pages_1.pagesRouter);
exports.router.use((req, res) => {
    if (req.path.startsWith("/api")) {
        res.status(404).json({ ok: false, error: `Route not found: ${req.method} ${req.path}` });
        return;
    }
    res.status(404).render("error", {
        statusCode: 404,
        message: "Page not found.",
        title: "404 — Not Found",
    });
});
