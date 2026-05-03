"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.artifactsRouter = void 0;
const express_1 = require("express");
const artifacts_controller_1 = require("../controllers/artifacts.controller");
exports.artifactsRouter = (0, express_1.Router)();
exports.artifactsRouter.get("/artifact", (req, res, next) => { (0, artifacts_controller_1.getArtifact)(req, res).catch(next); });
