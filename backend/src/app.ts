import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import path from "node:path";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { getStyleMdRunDir } from "@/lib/stylemd-artifacts/artifacts";
import { scrapeQueue } from "@/lib/queue/scrapeQueue";
import { router as apiRouter } from "./routes/index";
import { adminRouter } from "./routes/admin";
import { publicRouter } from "./routes/public";
import { errorHandler } from "./middleware/errorHandler";
import { requireAdmin } from "./middleware/requireAdmin";

export function createApp(): express.Application {
  const app = express();

  app.use(cors({
    origin: process.env.CORS_ORIGINS
      ? process.env.CORS_ORIGINS.split(",").map((o) => o.trim())
      : ["http://localhost:3000", "http://localhost:3001", "http://localhost:3002", "http://localhost:3003", "http://localhost:3004"],
    credentials: true,
  }));
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true }));

  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "views"));

  app.use(express.static(path.join(__dirname, "../public")));

  // (Legacy /runs static mount removed in storage v2 — artifacts live in R2.)

  app.use(
    "/styleguide-files/:runId",
    (req: express.Request, res: express.Response, next: express.NextFunction) => {
      const runDir = getStyleMdRunDir(req.params.runId);
      express.static(runDir, {
        dotfiles: "ignore",
        index: false,
        setHeaders(res) {
          res.setHeader("Cache-Control", "no-store");
        },
      })(req, res, next);
    },
  );

  // ── Bull Board dashboard at /admin/queues (token-gated via Authorization header).
  const bullBoardAdapter = new ExpressAdapter();
  bullBoardAdapter.setBasePath("/admin/queues");
  createBullBoard({
    queues: [new BullMQAdapter(scrapeQueue)],
    serverAdapter: bullBoardAdapter,
  });
  app.use("/admin/queues", requireAdmin, bullBoardAdapter.getRouter());

  // ── Public API (no auth, or Firebase token only — no role check).
  const scrapeRateLimit = rateLimit({
    windowMs: 60_000,
    max: 5,
    keyGenerator: (req) => req.headers.authorization?.slice(7) || "anonymous",
    message: { ok: false, error: "Too many scrape requests — try again in a minute" },
    validate: { xForwardedForHeader: false },
  });
  const authLinkRateLimit = rateLimit({
    windowMs: 15 * 60_000,
    max: 5,
    keyGenerator: (req) => (req.body as { email?: string })?.email?.toLowerCase() || req.ip || "anonymous",
    message: { success: true, message: "If an account exists, a sign-in link has been sent." },
    validate: { xForwardedForHeader: false },
  });
  app.use("/api/public/scrape", scrapeRateLimit);
  app.use("/api/public/auth/send-link", authLinkRateLimit);
  app.use("/api/public", publicRouter);

  // ── JSON admin API.
  app.use("/api/admin", adminRouter);

  app.use("/", apiRouter);
  app.use(errorHandler);

  return app;
}
