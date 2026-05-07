"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sessionRouter = void 0;
const express_1 = require("express");
const session_controller_1 = require("../controllers/session.controller");
exports.sessionRouter = (0, express_1.Router)();
// GET /api/session/events
// Stream pipeline events (SSE)
exports.sessionRouter.get("/events", session_controller_1.getSessionEvents);
// INTERNAL / UNUSED (Reset current session state)
exports.sessionRouter.post("/reset", (req, res, next) => { (0, session_controller_1.resetSession)(req, res).catch(next); });
