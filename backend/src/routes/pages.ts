import { Router, type Request, type Response, type NextFunction } from "express";
import { getLatestStyleMdShowcaseRunSummary } from "@/lib/stylemd-artifacts/runManager";

export const pagesRouter = Router();

pagesRouter.get("/", (_req: Request, res: Response) => { res.redirect(302, "/stylemd"); });

pagesRouter.get("/stylemd", (_req: Request, res: Response) => {
  res.render("layout", { title: "StyleMD Lab", description: "Local-first StyleMD control room and artifact pipeline." });
});

pagesRouter.get("/styleguide", (req: Request, res: Response, next: NextFunction) => {
  (async () => {
    const summary = await getLatestStyleMdShowcaseRunSummary();
    if (!summary || !summary.showcase.available) {
      res.status(404).render("error", { statusCode: 404, message: "No styleguide is available yet. Run an analysis first.", title: "No Styleguide Found" });
      return;
    }
    res.redirect(302, summary.showcase.canonicalUrl);
  })().catch(next);
});

pagesRouter.get("/styleguide/:runId", (req: Request, res: Response) => {
  const { runId } = req.params;
  res.render("styleguide-viewer", { title: `Styleguide — ${runId}`, runId, showcaseSrc: `/styleguide-files/${encodeURIComponent(runId)}/styleguide/showcase.html`, downloadUrl: `/api/stylemd/download-styleguide-v2?runId=${encodeURIComponent(runId)}` });
});
