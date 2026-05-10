import { Router } from "express";
import { getArtifact } from "../controllers/artifacts.controller";

export const artifactsRouter = Router();

// INTERNAL / UNUSED (Retrieve pipeline artifacts)
artifactsRouter.get("/artifact", (req, res, next) => { getArtifact(req, res).catch(next); });
