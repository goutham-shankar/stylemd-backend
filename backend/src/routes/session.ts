import { Router } from "express";
import { getSessionEvents, resetSession } from "../controllers/session.controller";

export const sessionRouter = Router();

// GET /api/session/events
// Stream pipeline events (SSE)
sessionRouter.get("/events", getSessionEvents);

// INTERNAL / UNUSED (Reset current session state)
sessionRouter.post("/reset", (req, res, next) => { resetSession(req, res).catch(next); });
