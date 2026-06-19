import type { Request, Response } from "express";
import mongoose from "mongoose";
import { StyleMdRun } from "../models/StyleMdRun";
import { ScrapedData } from "../models/ScrapedData";
import { Category } from "../models/Category";
import { r2PublicUrl, fetchR2Text, uploadR2, deleteR2, r2KeyFor } from "@/lib/queue/r2";
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
      const s = String(req.query.search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

// GET /api/admin/runs/by-slug/:slug
export async function getRunBySlug(req: Request, res: Response): Promise<void> {
  try {
    const doc = await StyleMdRun.findOne({ slug: req.params.slug })
      .sort({ createdAt: -1 })
      .lean() as Record<string, unknown> | null;
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

    // Also fetch matching scraped data
    const scraped = await ScrapedData.findOne({ url: doc.url as string })
      .select("-contentText -rawHtml")
      .lean();

    res.json({ ok: true, data: { ...doc, r2Urls, designMdText }, scraped: scraped ?? null });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

// DELETE /api/admin/runs/:runId
export async function deleteRun(req: Request, res: Response): Promise<void> {
  try {
    const doc = await StyleMdRun.findOne({ runId: req.params.runId }).lean() as Record<string, unknown> | null;
    if (!doc) {
      res.status(404).json({ ok: false, error: "Run not found" });
      return;
    }

    const slug = doc.slug as string | null;
    const r2 = doc.r2 as Record<string, unknown> | null;

    // Delete every stored R2 artifact key, then the manifest (derivable from slug)
    const r2Keys: (string | null | undefined)[] = r2
      ? [
          r2.previewHtml as string,
          r2.designMd as string,
          r2.screenshot as string,
          r2.semanticStructure as string,
          r2.designTokens as string,
        ]
      : [];

    await Promise.allSettled([
      ...r2Keys.filter(Boolean).map((key) => deleteR2(key as string)),
      slug ? deleteR2(r2KeyFor(slug, "manifest")) : Promise.resolve(),
      slug ? deleteR2(r2KeyFor(slug, "rawHtml")) : Promise.resolve(), // debug artifact, best-effort
    ]);

    // Remove from both collections
    await Promise.all([
      StyleMdRun.deleteOne({ runId: req.params.runId }),
      doc.url ? ScrapedData.deleteOne({ url: doc.url as string }) : Promise.resolve(),
    ]);

    res.json({ ok: true, deleted: 1 });
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

const BROWSABLE_COLLECTIONS = new Set([
  "stylemd_runs", "scraped_data", "categories", "users", "design_library",
]);

// GET /api/admin/collections/:name?page=1&limit=20
export async function browseCollection(req: Request, res: Response): Promise<void> {
  try {
    const { name } = req.params;
    if (!BROWSABLE_COLLECTIONS.has(name)) {
      res.status(403).json({ ok: false, error: `Collection "${name}" is not browsable` });
      return;
    }
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
    const allowed = ["title", "description", "status", "error", "category", "featured"] as const;
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

// GET /api/admin/categories
// Returns distinct category names with run counts, sorted by count desc.
// Merges categories from the Category collection with those found on runs.
export async function listCategories(_req: Request, res: Response): Promise<void> {
  try {
    const [catDocs, rows] = await Promise.all([
      Category.find({}, { name: 1 }).lean(),
      StyleMdRun.aggregate([
        { $group: { _id: "$category", count: { $sum: 1 } } },
      ]),
    ]);

    const countMap = new Map<string, number>(
      rows.map((r: { _id: string | null; count: number }) => [r._id ?? "Other", r.count]),
    );

    // Collect all unique names from Category collection and existing runs
    const allNames = new Set<string>();
    for (const doc of catDocs) allNames.add(doc.name);
    for (const name of countMap.keys()) allNames.add(name);

    const data = Array.from(allNames)
      .map((name) => ({ name, count: countMap.get(name) ?? 0 }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

// POST /api/admin/categories
// Body: { name } — creates a new category in the Category collection.
export async function createCategory(req: Request, res: Response): Promise<void> {
  try {
    const { name } = req.body as { name?: string };
    if (!name || typeof name !== "string" || !name.trim()) {
      res.status(400).json({ ok: false, error: "name is required" });
      return;
    }
    const trimmed = name.trim();

    // Check if already exists in Category collection
    const existing = await Category.findOne({ name: trimmed }).lean();
    if (existing) {
      res.status(409).json({ ok: false, error: "Category already exists." });
      return;
    }

    const doc = await Category.create({ name: trimmed });
    res.status(201).json({ ok: true, data: { name: doc.name, count: 0 } });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      res.status(409).json({ ok: false, error: "Category already exists." });
      return;
    }
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

// PATCH /api/admin/categories/rename
// Body: { oldName, newName } — renames a category across all runs.
export async function renameCategory(req: Request, res: Response): Promise<void> {
  try {
    const { oldName, newName } = req.body as { oldName?: string; newName?: string };
    if (!oldName || !newName || typeof oldName !== "string" || typeof newName !== "string") {
      res.status(400).json({ ok: false, error: "oldName and newName are required" });
      return;
    }
    const [result] = await Promise.all([
      StyleMdRun.updateMany(
        { category: oldName },
        { $set: { category: newName.trim() } },
      ),
      Category.updateOne(
        { name: oldName },
        { $set: { name: newName.trim() } },
      ),
    ]);
    res.json({ ok: true, updated: result.modifiedCount });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

// DELETE /api/admin/categories/:name
// Resets all runs with this category to "Other" and removes it from the Category collection.
export async function deleteCategory(req: Request, res: Response): Promise<void> {
  try {
    const { name } = req.params;
    const [runResult] = await Promise.all([
      StyleMdRun.updateMany(
        { category: name },
        { $set: { category: "Other" } },
      ),
      Category.deleteOne({ name }),
    ]);
    res.json({ ok: true, updated: runResult.modifiedCount });
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

// POST /api/admin/scrape  { url, provider?, force? }
export async function newScrape(req: Request, res: Response): Promise<void> {
  try {
    const { url, provider, force } = req.body as { url?: string; provider?: string; force?: boolean };
    if (!url || typeof url !== "string") {
      res.status(400).json({ ok: false, error: "URL is required" });
      return;
    }

    let normalizedUrl = url.trim();
    if (!/^https?:\/\//i.test(normalizedUrl)) normalizedUrl = `https://${normalizedUrl}`;

    const slug = urlToSlug(normalizedUrl);
    const jobId = `scrape-${slug}`;

    const existingJob = await scrapeQueue.getJob(jobId);
    if (existingJob && !force) {
      const state = await existingJob.getState();
      if (state === "waiting" || state === "active" || state === "delayed") {
        res.json({ ok: true, jobId, status: state, url: normalizedUrl, message: "Already in progress" });
        return;
      }
    }
    if (existingJob) {
      await existingJob.remove().catch(() => undefined);
    }

    await scrapeQueue.add("scrape", { url: normalizedUrl, provider: provider || "kimi" }, { jobId });
    res.json({ ok: true, jobId, status: "queued", url: normalizedUrl, slug });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

// GET /api/admin/runs/by-slug/:slug/html
export async function getRunHtml(req: Request, res: Response): Promise<void> {
  try {
    const doc = await StyleMdRun.findOne({ slug: req.params.slug })
      .sort({ createdAt: -1 })
      .lean() as Record<string, unknown> | null;
    if (!doc) { res.status(404).json({ ok: false, error: "Run not found" }); return; }

    const r2 = (doc.r2 as Record<string, unknown> | null) ?? null;
    const htmlKey = r2?.previewHtml as string | null;
    const html = await fetchR2Text(htmlKey);
    res.json({ ok: true, html: html ?? "", key: htmlKey });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

// PUT /api/admin/runs/by-slug/:slug/html
export async function updateRunHtml(req: Request, res: Response): Promise<void> {
  try {
    const doc = await StyleMdRun.findOne({ slug: req.params.slug })
      .sort({ createdAt: -1 })
      .lean() as Record<string, unknown> | null;
    if (!doc) { res.status(404).json({ ok: false, error: "Run not found" }); return; }

    const r2 = (doc.r2 as Record<string, unknown> | null) ?? null;
    const htmlKey = r2?.previewHtml as string | null;
    if (!htmlKey) { res.status(400).json({ ok: false, error: "No preview HTML key on this run" }); return; }

    const { html } = req.body as { html?: string };
    if (typeof html !== "string") { res.status(400).json({ ok: false, error: "html field is required" }); return; }

    await uploadR2(htmlKey, html, "text/html; charset=utf-8");
    res.json({ ok: true, message: "HTML updated", key: htmlKey });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

// PATCH /api/admin/runs/bulk
export async function bulkUpdateRuns(req: Request, res: Response): Promise<void> {
  try {
    const { runIds, updates } = req.body as { runIds?: string[]; updates?: Record<string, unknown> };
    if (!Array.isArray(runIds) || runIds.length === 0) {
      res.status(400).json({ ok: false, error: "runIds array is required" });
      return;
    }
    const allowed = ["featured", "category", "status"] as const;
    const safe: Record<string, unknown> = {};
    for (const key of allowed) {
      if (updates && key in updates) safe[key] = updates[key];
    }
    if (Object.keys(safe).length === 0) {
      res.status(400).json({ ok: false, error: "No valid fields to update" });
      return;
    }
    const result = await StyleMdRun.updateMany(
      { runId: { $in: runIds } },
      { $set: safe },
    );
    res.json({ ok: true, modified: result.modifiedCount });
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
