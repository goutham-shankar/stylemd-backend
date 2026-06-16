import type { Request, Response } from "express";
import mongoose from "mongoose";
import { StyleMdRun } from "../models/StyleMdRun";
import { ScrapedData } from "../models/ScrapedData";
import { r2PublicUrl, fetchR2Text } from "@/lib/queue/r2";
import { scrapeQueue } from "@/lib/queue/scrapeQueue";
import { urlToSlug } from "../services/runStorage";

// GET /api/admin/stats
export async function getDashboardStats(_req: Request, res: Response): Promise<void> {
  try {
    const [runStats, scrapedStats] = await Promise.all([
      StyleMdRun.aggregate([
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      ScrapedData.aggregate([
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
    ]);

    const runsByStatus: Record<string, number> = {};
    for (const s of runStats) runsByStatus[s._id ?? "unknown"] = s.count;

    const scrapedByStatus: Record<string, number> = {};
    for (const s of scrapedStats) scrapedByStatus[s._id ?? "unknown"] = s.count;

    const totalRuns = Object.values(runsByStatus).reduce((a, b) => a + b, 0);
    const totalScraped = Object.values(scrapedByStatus).reduce((a, b) => a + b, 0);

    const recentRuns = await StyleMdRun.find({})
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    const dbStats = await mongoose.connection.db!.stats();

    res.json({
      ok: true,
      data: {
        runs: { total: totalRuns, byStatus: runsByStatus },
        scraped: { total: totalScraped, byStatus: scrapedByStatus },
        recentRuns,
        r2PublicBase: (process.env.R2_PUBLIC_BASE ?? "").replace(/\/+$/, "") || null,
        db: {
          name: mongoose.connection.db!.databaseName,
          collections: dbStats.collections,
          dataSize: dbStats.dataSize,
          storageSize: dbStats.storageSize,
          indexes: dbStats.indexes,
          indexSize: dbStats.indexSize,
        },
      },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

// GET /api/admin/runs?page=1&limit=20&status=completed
export async function listRuns(req: Request, res: Response): Promise<void> {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10));
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "20"), 10)));
    const skip = (page - 1) * limit;

    const filter: Record<string, unknown> = {};
    if (req.query.status && req.query.status !== "all") filter.status = req.query.status;
    if (req.query.search) {
      const s = String(req.query.search);
      filter.$or = [
        { url: { $regex: s, $options: "i" } },
        { slug: { $regex: s, $options: "i" } },
        { runId: { $regex: s, $options: "i" } },
      ];
    }

    const [docs, total] = await Promise.all([
      StyleMdRun.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      StyleMdRun.countDocuments(filter),
    ]);

    res.json({ ok: true, data: docs, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

// GET /api/admin/runs/:runId
export async function getRunDetail(req: Request, res: Response): Promise<void> {
  try {
    const doc = await StyleMdRun.findOne({ runId: req.params.runId }).lean() as Record<string, unknown> | null;
    if (!doc) {
      res.status(404).json({ ok: false, error: "Run not found" });
      return;
    }

    const r2 = (doc.r2 as Record<string, unknown> | null) ?? null;
    const r2Urls: Record<string, string | null> = {
      previewHtml: r2PublicUrl(r2?.previewHtml as string | null),
      designMd: r2PublicUrl(r2?.designMd as string | null),
      screenshot: r2PublicUrl(r2?.screenshot as string | null),
      semanticStructure: r2PublicUrl(r2?.semanticStructure as string | null),
      designTokens: r2PublicUrl(r2?.designTokens as string | null),
    };

    const designMdText = await fetchR2Text(r2?.designMd as string | null);

    res.json({ ok: true, data: { ...doc, r2Urls, designMdText } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

// DELETE /api/admin/runs/:runId
export async function deleteRun(req: Request, res: Response): Promise<void> {
  try {
    const result = await StyleMdRun.deleteOne({ runId: req.params.runId });
    res.json({ ok: true, deleted: result.deletedCount });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

// GET /api/admin/scraped?page=1&limit=20&status=completed
export async function listScraped(req: Request, res: Response): Promise<void> {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10));
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "20"), 10)));
    const skip = (page - 1) * limit;

    const filter: Record<string, unknown> = {};
    if (req.query.status && req.query.status !== "all") filter.status = req.query.status;
    if (req.query.search) {
      const s = String(req.query.search);
      filter.$or = [
        { url: { $regex: s, $options: "i" } },
        { slug: { $regex: s, $options: "i" } },
      ];
    }

    const [docs, total] = await Promise.all([
      ScrapedData.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit)
        .select("-contentText -rawHtml")
        .lean(),
      ScrapedData.countDocuments(filter),
    ]);

    res.json({ ok: true, data: docs, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

// GET /api/admin/scraped/:id
export async function getScrapedDetail(req: Request, res: Response): Promise<void> {
  try {
    const doc = await ScrapedData.findById(req.params.id).lean();
    if (!doc) {
      res.status(404).json({ ok: false, error: "Document not found" });
      return;
    }
    res.json({ ok: true, data: doc });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

// DELETE /api/admin/scraped/:id
export async function deleteScraped(req: Request, res: Response): Promise<void> {
  try {
    const result = await ScrapedData.deleteOne({ _id: req.params.id });
    res.json({ ok: true, deleted: result.deletedCount });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

// GET /api/admin/collections
export async function listCollections(_req: Request, res: Response): Promise<void> {
  try {
    const collections = await mongoose.connection.db!.listCollections().toArray();
    const result = await Promise.all(
      collections.map(async (c) => {
        const coll = mongoose.connection.db!.collection(c.name);
        const count = await coll.countDocuments();
        const stats = await coll.stats().catch(() => null);
        return {
          name: c.name,
          type: c.type,
          count,
          size: stats?.size ?? 0,
          storageSize: stats?.storageSize ?? 0,
          indexes: stats?.nindexes ?? 0,
        };
      }),
    );
    res.json({ ok: true, data: result.sort((a, b) => a.name.localeCompare(b.name)) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

// GET /api/admin/collections/:name?page=1&limit=20
export async function browseCollection(req: Request, res: Response): Promise<void> {
  try {
    const { name } = req.params;
    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10));
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || "20"), 10)));
    const skip = (page - 1) * limit;

    const coll = mongoose.connection.db!.collection(name);
    const [docs, total] = await Promise.all([
      coll.find({}).sort({ _id: -1 }).skip(skip).limit(limit).toArray(),
      coll.countDocuments(),
    ]);

    res.json({ ok: true, data: docs, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

// PATCH /api/admin/runs/:runId
export async function updateRun(req: Request, res: Response): Promise<void> {
  try {
    const { runId } = req.params;
    const allowed = ["title", "description", "status", "error"] as const;
    const updates: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in req.body) updates[key] = req.body[key];
    }

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ ok: false, error: "No valid fields to update" });
      return;
    }

    const doc = await StyleMdRun.findOneAndUpdate(
      { runId },
      { $set: updates },
      { new: true },
    ).lean();

    if (!doc) {
      res.status(404).json({ ok: false, error: "Run not found" });
      return;
    }

    res.json({ ok: true, data: doc });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

// POST /api/admin/runs/:runId/rerun
export async function rerunScrape(req: Request, res: Response): Promise<void> {
  try {
    const { runId } = req.params;
    const doc = await StyleMdRun.findOne({ runId }).lean() as Record<string, unknown> | null;

    if (!doc) {
      res.status(404).json({ ok: false, error: "Run not found" });
      return;
    }

    const url = doc.url as string;
    const slug = urlToSlug(url);
    const jobId = `scrape-${slug}`;

    // Remove existing job if present so the new one doesn't conflict
    const existingJob = await scrapeQueue.getJob(jobId);
    if (existingJob) {
      await existingJob.remove().catch(() => undefined);
    }

    // Delete the run document
    await StyleMdRun.deleteOne({ runId });

    // Re-queue the scrape
    await scrapeQueue.add("scrape", { url }, { jobId });

    res.json({ ok: true, message: "Re-scrape queued", jobId, url });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

// PATCH /api/admin/scraped/:id
export async function updateScraped(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const allowed = ["title", "description", "status"] as const;
    const updates: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in req.body) updates[key] = req.body[key];
    }

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ ok: false, error: "No valid fields to update" });
      return;
    }

    const doc = await ScrapedData.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true },
    ).lean();

    if (!doc) {
      res.status(404).json({ ok: false, error: "Document not found" });
      return;
    }

    res.json({ ok: true, data: doc });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}
