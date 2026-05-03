"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sessionRouter = void 0;
const express_1 = require("express");
const session_controller_1 = require("../controllers/session.controller");
exports.sessionRouter = (0, express_1.Router)();
exports.sessionRouter.get("/events", session_controller_1.getSessionEvents);
exports.sessionRouter.post("/reset", (req, res, next) => { (0, session_controller_1.resetSession)(req, res).catch(next); });
