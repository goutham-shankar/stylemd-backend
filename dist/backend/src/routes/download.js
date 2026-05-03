"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.downloadRouter = void 0;
const express_1 = require("express");
const download_controller_1 = require("../controllers/download.controller");
exports.downloadRouter = (0, express_1.Router)();
exports.downloadRouter.get("/download-styleguide-v2", (req, res, next) => { (0, download_controller_1.downloadStyleguideV2)(req, res).catch(next); });
