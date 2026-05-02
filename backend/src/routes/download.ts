import { Router } from "express";
import { downloadStyleguideV2 } from "../controllers/download.controller";

export const downloadRouter = Router();

downloadRouter.get("/download-styleguide-v2", (req, res, next) => { downloadStyleguideV2(req, res).catch(next); });
