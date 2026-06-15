import express from "express";
import cors from "cors";
import path from "node:path";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { getStyleMdRunDir } from "@/lib/stylemd-artifacts/artifacts";
import { scrapeQueue } from "@/lib/queue/scrapeQueue";
import { router as apiRouter } from "./routes/index";
import { queueAdminRouter } from "./routes/queueAdmin";
import { errorHandler } from "./middleware/errorHandler";
import { requireAdmin } from "./middleware/requireAdmin";

export function createApp(): express.Application {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true }));

  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "views"));

  app.use(express.static(path.join(__dirname, "../public")));

  // Serve saved preview HTML files at /runs/<slug>/preview.html (legacy local FS path).
  app.use("/runs", express.static(path.join(process.cwd(), "runs"), {
    dotfiles: "ignore",
    index: false,
    setHeaders(res) {
      res.setHeader("Cache-Control", "no-store");
    },
  }));

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

  // ── JSON admin API.
  app.use("/api/admin", queueAdminRouter);

  app.use("/", apiRouter);
  app.use(errorHandler);

  return app;
}
