import express from "express";
import cors from "cors";
import path from "node:path";
import { getStyleMdRunDir } from "@/lib/stylemd-artifacts/artifacts";
import { router as apiRouter } from "./routes/index";
import { errorHandler } from "./middleware/errorHandler";

export function createApp(): express.Application {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true }));

  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "views"));

  app.use(express.static(path.join(__dirname, "../../public")));

  // Serve saved preview HTML files at /runs/<slug>/preview.html
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

  app.use("/", apiRouter);
  app.use(errorHandler);

  return app;
}
