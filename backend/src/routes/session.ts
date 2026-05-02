import { Router } from "express";
import { getSessionEvents, resetSession } from "../controllers/session.controller";

export const sessionRouter = Router();

sessionRouter.get("/events", getSessionEvents);
sessionRouter.post("/reset", (req, res, next) => { resetSession(req, res).catch(next); });
