import { Router, type Request, type Response, type NextFunction } from "express";
import { StyleMdRun } from "../models/StyleMdRun";

export const pagesRouter = Router();

pagesRouter.get("/", (_req: Request, res: Response) => { res.redirect(302, "/stylemd"); });

pagesRouter.get("/stylemd", (_req: Request, res: Response) => {
  res.render("layout", { title: "StyleMD Lab", description: "Local-first StyleMD control room and artifact pipeline." });
});

pagesRouter.get("/styleguide", (req: Request, res: Response, next: NextFunction) => {
  (async () => {

    // Find the latest completed run
    const latest = await StyleMdRun.findOne({ 
      status: { $in: ["completed", "completed_with_warnings"] },
      runId: { $ne: null }
    }).sort({ createdAt: -1 }).lean<{ runId: string } | null>();

    if (!latest || !latest.runId) {
      res.status(404).render("error", { 
        statusCode: 404, 
        message: "No styleguide is available yet. Run an analysis first.", 
        title: "No Styleguide Found" 
      });
      return;
    }

    // Redirect to the latest run's styleguide viewer
    res.redirect(302, `/styleguide/${latest.runId}`);
  })().catch(next);
});

pagesRouter.get("/styleguide/:runId", (req: Request, res: Response) => {
  const { runId } = req.params;
  res.render("styleguide-viewer", { 
    title: `Styleguide — ${runId}`, 
    runId, 
    showcaseSrc: `/styleguide-files/${encodeURIComponent(runId)}/styleguide/showcase.html`, 
    downloadUrl: `/api/stylemd/download-styleguide-v2?runId=${encodeURIComponent(runId)}` 
  });
});
