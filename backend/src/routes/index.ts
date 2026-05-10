import { Router } from "express";
import { sessionRouter } from "./session";
import { artifactsRouter } from "./artifacts";
import { stylemdRouter } from "./stylemd";
import { scrapedDataRouter } from "./scrapedData";
import { downloadRouter } from "./download";
import { pagesRouter } from "./pages";

export const router = Router();

router.get("/health", (_req, res) => {
  res.json({ ok: true, status: "running" });
});

router.use("/api/session", sessionRouter);
router.use("/api/stylemd-artifacts", artifactsRouter);
router.use("/api/stylemd", stylemdRouter);
router.use("/api/stylemd", downloadRouter);
router.use("/api/scraped-data", scrapedDataRouter);
router.use("/", pagesRouter);

router.use((req, res) => {
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
