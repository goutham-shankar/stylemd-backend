"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDashboardStats = getDashboardStats;
exports.listRuns = listRuns;
exports.getRunDetail = getRunDetail;
exports.deleteRun = deleteRun;
exports.listScraped = listScraped;
exports.getScrapedDetail = getScrapedDetail;
exports.deleteScraped = deleteScraped;
exports.listCollections = listCollections;
exports.browseCollection = browseCollection;
const mongoose_1 = __importDefault(require("mongoose"));
const StyleMdRun_1 = require("../models/StyleMdRun");
const ScrapedData_1 = require("../models/ScrapedData");
const r2_1 = require("../../../lib/queue/r2");
// GET /api/admin/stats
async function getDashboardStats(_req, res) {
    try {
        const [runStats, scrapedStats] = await Promise.all([
            StyleMdRun_1.StyleMdRun.aggregate([
                { $group: { _id: "$status", count: { $sum: 1 } } },
            ]),
            ScrapedData_1.ScrapedData.aggregate([
                { $group: { _id: "$status", count: { $sum: 1 } } },
            ]),
        ]);
        const runsByStatus = {};
        for (const s of runStats)
            runsByStatus[s._id ?? "unknown"] = s.count;
        const scrapedByStatus = {};
        for (const s of scrapedStats)
            scrapedByStatus[s._id ?? "unknown"] = s.count;
        const totalRuns = Object.values(runsByStatus).reduce((a, b) => a + b, 0);
        const totalScraped = Object.values(scrapedByStatus).reduce((a, b) => a + b, 0);
        const recentRuns = await StyleMdRun_1.StyleMdRun.find({})
            .sort({ createdAt: -1 })
            .limit(5)
            .lean();
        const dbStats = await mongoose_1.default.connection.db.stats();
        res.json({
            ok: true,
            data: {
                runs: { total: totalRuns, byStatus: runsByStatus },
                scraped: { total: totalScraped, byStatus: scrapedByStatus },
                recentRuns,
                db: {
                    name: mongoose_1.default.connection.db.databaseName,
                    collections: dbStats.collections,
                    dataSize: dbStats.dataSize,
                    storageSize: dbStats.storageSize,
                    indexes: dbStats.indexes,
                    indexSize: dbStats.indexSize,
                },
            },
        });
    }
    catch (err) {
        res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
}
// GET /api/admin/runs?page=1&limit=20&status=completed
async function listRuns(req, res) {
    try {
        const page = Math.max(1, parseInt(String(req.query.page || "1"), 10));
        const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "20"), 10)));
        const skip = (page - 1) * limit;
        const filter = {};
        if (req.query.status && req.query.status !== "all")
            filter.status = req.query.status;
        if (req.query.search) {
            const s = String(req.query.search);
            filter.$or = [
                { url: { $regex: s, $options: "i" } },
                { slug: { $regex: s, $options: "i" } },
                { runId: { $regex: s, $options: "i" } },
            ];
        }
        const [docs, total] = await Promise.all([
            StyleMdRun_1.StyleMdRun.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
            StyleMdRun_1.StyleMdRun.countDocuments(filter),
        ]);
        res.json({ ok: true, data: docs, total, page, limit, pages: Math.ceil(total / limit) });
    }
    catch (err) {
        res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
}
// GET /api/admin/runs/:runId
async function getRunDetail(req, res) {
    try {
        const doc = await StyleMdRun_1.StyleMdRun.findOne({ runId: req.params.runId }).lean();
        if (!doc) {
            res.status(404).json({ ok: false, error: "Run not found" });
            return;
        }
        const r2 = doc.r2 ?? null;
        const r2Urls = {
            previewHtml: (0, r2_1.r2PublicUrl)(r2?.previewHtml),
            designMd: (0, r2_1.r2PublicUrl)(r2?.designMd),
            screenshot: (0, r2_1.r2PublicUrl)(r2?.screenshot),
            semanticStructure: (0, r2_1.r2PublicUrl)(r2?.semanticStructure),
            designTokens: (0, r2_1.r2PublicUrl)(r2?.designTokens),
        };
        const designMdText = await (0, r2_1.fetchR2Text)(r2?.designMd);
        res.json({ ok: true, data: { ...doc, r2Urls, designMdText } });
    }
    catch (err) {
        res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
}
// DELETE /api/admin/runs/:runId
async function deleteRun(req, res) {
    try {
        const result = await StyleMdRun_1.StyleMdRun.deleteOne({ runId: req.params.runId });
        res.json({ ok: true, deleted: result.deletedCount });
    }
    catch (err) {
        res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
}
// GET /api/admin/scraped?page=1&limit=20&status=completed
async function listScraped(req, res) {
    try {
        const page = Math.max(1, parseInt(String(req.query.page || "1"), 10));
        const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "20"), 10)));
        const skip = (page - 1) * limit;
        const filter = {};
        if (req.query.status && req.query.status !== "all")
            filter.status = req.query.status;
        if (req.query.search) {
            const s = String(req.query.search);
            filter.$or = [
                { url: { $regex: s, $options: "i" } },
                { slug: { $regex: s, $options: "i" } },
            ];
        }
        const [docs, total] = await Promise.all([
            ScrapedData_1.ScrapedData.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit)
                .select("-contentText -rawHtml")
                .lean(),
            ScrapedData_1.ScrapedData.countDocuments(filter),
        ]);
        res.json({ ok: true, data: docs, total, page, limit, pages: Math.ceil(total / limit) });
    }
    catch (err) {
        res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
}
// GET /api/admin/scraped/:id
async function getScrapedDetail(req, res) {
    try {
        const doc = await ScrapedData_1.ScrapedData.findById(req.params.id).lean();
        if (!doc) {
            res.status(404).json({ ok: false, error: "Document not found" });
            return;
        }
        res.json({ ok: true, data: doc });
    }
    catch (err) {
        res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
}
// DELETE /api/admin/scraped/:id
async function deleteScraped(req, res) {
    try {
        const result = await ScrapedData_1.ScrapedData.deleteOne({ _id: req.params.id });
        res.json({ ok: true, deleted: result.deletedCount });
    }
    catch (err) {
        res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
}
// GET /api/admin/collections
async function listCollections(_req, res) {
    try {
        const collections = await mongoose_1.default.connection.db.listCollections().toArray();
        const result = await Promise.all(collections.map(async (c) => {
            const coll = mongoose_1.default.connection.db.collection(c.name);
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
        }));
        res.json({ ok: true, data: result.sort((a, b) => a.name.localeCompare(b.name)) });
    }
    catch (err) {
        res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
}
// GET /api/admin/collections/:name?page=1&limit=20
async function browseCollection(req, res) {
    try {
        const { name } = req.params;
        const page = Math.max(1, parseInt(String(req.query.page || "1"), 10));
        const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || "20"), 10)));
        const skip = (page - 1) * limit;
        const coll = mongoose_1.default.connection.db.collection(name);
        const [docs, total] = await Promise.all([
            coll.find({}).sort({ _id: -1 }).skip(skip).limit(limit).toArray(),
            coll.countDocuments(),
        ]);
        res.json({ ok: true, data: docs, total, page, limit, pages: Math.ceil(total / limit) });
    }
    catch (err) {
        res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
}
