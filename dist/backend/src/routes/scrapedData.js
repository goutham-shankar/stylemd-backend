"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scrapedDataRouter = void 0;
const express_1 = require("express");
const scrapedData_controller_1 = require("../controllers/scrapedData.controller");
exports.scrapedDataRouter = (0, express_1.Router)();
exports.scrapedDataRouter.post("/", (req, res, next) => { (0, scrapedData_controller_1.createScrapedData)(req, res).catch(next); });
exports.scrapedDataRouter.get("/", (req, res, next) => { (0, scrapedData_controller_1.listScrapedData)(req, res).catch(next); });
