import type { Request, Response } from "express";
import { StyleMdRun } from "../models/StyleMdRun";
import { Category } from "../models/Category";
import { User } from "../models/User";
import { scrapeQueue } from "@/lib/queue/scrapeQueue";
import { r2PublicUrl, fetchR2Text } from "@/lib/queue/r2";
import { verifyIdToken } from "../lib/firebaseAdmin";
import { urlToSlug } from "../services/runStorage";

// POST /api/public/scrape
// Requires Firebase ID token in Authorization header. Any signed-in user can submit.
export async function publicScrape(req: Request, res: Response): Promise<void> {
  const header = req.headers.authorization || "";
  const idToken = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!idToken) {
    res.status(401).json({ ok: false, error: "Sign in to generate a DESIGN.md" });
    return;
  }

  let uid: string;
  try {
    const decoded = await verifyIdToken(idToken);
    uid = decoded.uid;
  } catch {
    res.status(401).json({ ok: false, error: "Invalid or expired session" });
    return;
  }

  const { url } = req.body as { url?: string };
  if (!url || typeof url !== "string") {
    res.status(400).json({ ok: false, error: "url is required" });
    return;
  }

  let normalizedUrl = url.trim();
  if (!/^https?:\/\//i.test(normalizedUrl)) normalizedUrl = `https://${normalizedUrl}`;
  const slug = urlToSlug(normalizedUrl);

  // Return cached completed run — only associate user if it was a scrape-sourced run
  const existing = await StyleMdRun.findOne({ slug, status: "completed" })
    .sort({ createdAt: -1 })
    .lean() as Record<string, unknown> | null;
  if (existing) {
    if (existing["source"] === "scrape") {
      StyleMdRun.updateOne(
        { runId: existing["runId"] },
        { $addToSet: { userIds: uid } },
      ).catch(() => undefined);
    }
    res.json({ ok: true, slug, runId: existing["runId"], status: "completed", cached: true });
    return;
  }

  // Check if already in queue
  const jobId = `scrape-${slug}`;
  const existingJob = await scrapeQueue.getJob(jobId);
  if (existingJob) {
    const state = await existingJob.getState();
    if (state === "waiting" || state === "active" || state === "delayed") {
      res.json({ ok: true, jobId, slug, status: state, cached: false });
      return;
    }
    await existingJob.remove().catch(() => undefined);
  }

  await scrapeQueue.add("scrape", { url: normalizedUrl, provider: "kimi", userId: uid }, { jobId });
  res.json({ ok: true, jobId, slug, status: "queued", cached: false });
}

// GET /api/public/runs/:slug/status — poll during scrape progress
export async function publicRunStatus(req: Request, res: Response): Promise<void> {
  try {
    const { slug } = req.params;
    const run = await StyleMdRun.findOne({ slug }).sort({ createdAt: -1 }).lean() as Record<string, unknown> | null;
    if (run) {
      res.json({ ok: true, slug, status: run["status"] });
      return;
    }
    const jobId = `scrape-${slug}`;
    const job = await scrapeQueue.getJob(jobId);
    if (job) {
      const state = await job.getState();
      res.json({ ok: true, slug, status: state });
      return;
    }
    res.json({ ok: true, slug, status: "not_found" });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

// GET /api/public/runs — list completed runs
export async function publicListRuns(req: Request, res: Response): Promise<void> {
  try {
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || "24"), 10)));
    const filter: Record<string, unknown> = { status: "completed", slug: { $ne: null }, featured: true };
    const runs = await StyleMdRun.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .select("runId url slug title description category r2 createdAt")
      .lean();

    const data = runs.map((r) => {
      const r2 = (r.r2 as Record<string, unknown> | null) ?? {};
      return {
        runId: r.runId,
        url: r.url,
        slug: r.slug,
        title: r.title ?? null,
        description: r.description ?? null,
        category: (r.category as string | null) ?? "Other",
        screenshot: r2PublicUrl(r2.screenshot as string | null),
        createdAt: r.createdAt,
      };
    });

    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

// GET /api/public/runs/mine — list runs scraped by the authenticated user
export async function publicMyRuns(req: Request, res: Response): Promise<void> {
  const header = req.headers.authorization || "";
  const idToken = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!idToken) {
    res.status(401).json({ ok: false, error: "Sign in to view your library" });
    return;
  }

  let uid: string;
  try {
    const decoded = await verifyIdToken(idToken);
    uid = decoded.uid;
  } catch {
    res.status(401).json({ ok: false, error: "Invalid or expired session" });
    return;
  }

  try {
    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10));
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || "20"), 10)));
    const skip = (page - 1) * limit;
    const filter: Record<string, unknown> = { userIds: uid };
    const [runs, total] = await Promise.all([
      StyleMdRun.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select("runId url slug title description category status r2 createdAt")
        .lean(),
      StyleMdRun.countDocuments(filter),
    ]);

    const data = runs.map((r) => {
      const r2 = (r.r2 as Record<string, unknown> | null) ?? {};
      return {
        runId: r.runId,
        url: r.url,
        slug: r.slug,
        title: r.title ?? null,
        description: r.description ?? null,
        category: (r.category as string | null) ?? "Other",
        status: (r.status as string) ?? "running",
        screenshot: r2PublicUrl(r2.screenshot as string | null),
        createdAt: r.createdAt,
      };
    });

    res.json({ ok: true, data, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

// GET /api/public/runs/:slug — single run detail with DESIGN.md text
export async function publicGetRun(req: Request, res: Response): Promise<void> {
  try {
    const run = await StyleMdRun.findOne({ slug: req.params.slug, status: "completed" })
      .sort({ createdAt: -1 })
      .lean() as Record<string, unknown> | null;

    if (!run) {
      res.status(404).json({ ok: false, error: "Not found" });
      return;
    }

    const r2 = (run.r2 as Record<string, unknown> | null) ?? {};
    const designMdText = await fetchR2Text(r2.designMd as string | null);

    res.json({
      ok: true,
      data: {
        runId: run.runId,
        url: run.url,
        slug: run.slug,
        title: run.title ?? null,
        description: run.description ?? null,
        category: (run.category as string | null) ?? "Other",
        screenshot: r2PublicUrl(r2.screenshot as string | null),
        previewHtml: r2PublicUrl(r2.previewHtml as string | null),
        designMd: designMdText ?? "",
        createdAt: run.createdAt,
      },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

// GET /api/public/categories
// Returns all known categories (from Category collection + runs) with run counts, sorted by count desc.
export async function publicListCategories(_req: Request, res: Response): Promise<void> {
  try {
    const [catDocs, rows] = await Promise.all([
      Category.find({}, { name: 1 }).lean(),
      StyleMdRun.aggregate([
        { $match: { status: "completed", slug: { $ne: null }, featured: true } },
        { $group: { _id: "$category", count: { $sum: 1 } } },
      ]),
    ]);

    const countMap = new Map<string, number>(
      rows.map((r) => [r._id ?? "Other", r.count]),
    );

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

// POST /api/public/auth/sync
// Called by the probe frontend after Google/email sign-in to persist the user in MongoDB.
export async function publicAuthSync(req: Request, res: Response): Promise<void> {
  const header = req.headers.authorization || "";
  const idToken = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!idToken) {
    res.status(401).json({ ok: false, error: "No token" });
    return;
  }

  try {
    const decoded = await verifyIdToken(idToken);

    const user = await User.findOneAndUpdate(
      { uid: decoded.uid },
      {
        $set: {
          email: decoded.email ?? "",
          name: decoded.name ?? decoded.email ?? "Unknown",
          photoURL: decoded.picture ?? undefined,
          lastLoginAt: new Date(),
        },
        $setOnInsert: { role: "user", createdAt: new Date() },
      },
      { upsert: true, new: true },
    );

    res.json({ ok: true, data: { uid: user.uid, email: user.email, name: user.name, role: user.role } });
  } catch {
    res.status(401).json({ ok: false, error: "Invalid or expired session" });
  }
}
