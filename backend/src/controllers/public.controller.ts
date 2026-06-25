import type { Request, Response } from "express";
import { StyleMdRun } from "../models/StyleMdRun";
import { Category } from "../models/Category";
import { User } from "../models/User";
import { scrapeQueue, scrapeQueueEvents } from "@/lib/queue/scrapeQueue";
import { r2PublicUrl, fetchR2Text } from "@/lib/queue/r2";
import { verifyIdToken } from "../lib/firebaseAdmin";
import { urlToSlug } from "../services/runStorage";
import { sendWelcomeEmail } from "../services/email";

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

  let parsed: URL;
  try {
    parsed = new URL(normalizedUrl);
  } catch {
    res.status(400).json({ ok: false, error: "Invalid URL" });
    return;
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block non-HTTP schemes, IPs, localhost, and internal networks
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    res.status(400).json({ ok: false, error: "Only http/https URLs are allowed" });
    return;
  }
  if (/^(localhost|127\.\d|10\.\d|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0|\[::1?\])/.test(hostname)) {
    res.status(400).json({ ok: false, error: "Internal/private URLs are not allowed" });
    return;
  }

  // Must look like an actual website — require a TLD with 2+ chars
  const parts = hostname.split(".");
  if (parts.length < 2 || (parts[parts.length - 1]?.length ?? 0) < 2) {
    res.status(400).json({ ok: false, error: "Please enter a valid website URL" });
    return;
  }

  // Block API test/dev/non-website domains
  const BLOCKED_DOMAINS = [
    "httpbin.org", "example.com", "example.org", "example.net",
    "jsonplaceholder.typicode.com", "reqres.in", "postman-echo.com",
    "webhook.site", "requestbin.com",
  ];
  if (BLOCKED_DOMAINS.some((d) => hostname === d || hostname.endsWith(`.${d}`))) {
    res.status(400).json({ ok: false, error: "This URL is not a real website" });
    return;
  }

  // Strip path, query, hash — only scrape the homepage
  normalizedUrl = `${parsed.protocol}//${parsed.hostname}`;

  const slug = urlToSlug(normalizedUrl);

  // Return cached completed run — only associate user if it was a scrape-sourced run
  const existing = await StyleMdRun.findOne({ slug, status: { $in: ["completed", "completed_with_warnings"] } })
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

// GET /api/public/runs/:slug/events — SSE stream for real-time job progress
export async function publicRunEvents(req: Request, res: Response): Promise<void> {
  const { slug } = req.params;
  const jobId = `scrape-${slug}`;

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (event: string, data: Record<string, unknown>) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Check if already completed/failed before listening
  const run = await StyleMdRun.findOne({ slug }).sort({ createdAt: -1 }).lean() as Record<string, unknown> | null;
  if (run && (run["status"] === "completed" || run["status"] === "completed_with_warnings")) {
    send("completed", { slug, status: "completed" });
    res.end();
    return;
  }
  if (run && run["status"] === "failed") {
    send("failed", { slug, status: "failed" });
    res.end();
    return;
  }

  const job = await scrapeQueue.getJob(jobId);
  if (job) {
    const state = await job.getState();
    send("status", { slug, status: state, progress: job.progress });
    if (state === "completed") { res.end(); return; }
    if (state === "failed") { send("failed", { slug, status: "failed" }); res.end(); return; }
  } else {
    send("status", { slug, status: "not_found" });
  }

  const heartbeat = setInterval(() => { res.write(": ping\n\n"); }, 15_000);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onProgress = ({ jobId: jid, data }: { jobId: string; data: any }) => {
    if (jid !== jobId) return;
    send("progress", { slug, progress: data });
  };
  const onCompleted = ({ jobId: jid }: { jobId: string }) => {
    if (jid !== jobId) return;
    send("completed", { slug, status: "completed" });
    cleanup();
  };
  const onFailed = ({ jobId: jid, failedReason }: { jobId: string; failedReason: string }) => {
    if (jid !== jobId) return;
    send("failed", { slug, status: "failed", error: failedReason });
    cleanup();
  };

  scrapeQueueEvents.on("progress", onProgress);
  scrapeQueueEvents.on("completed", onCompleted);
  scrapeQueueEvents.on("failed", onFailed);

  const cleanup = () => {
    clearInterval(heartbeat);
    scrapeQueueEvents.off("progress", onProgress);
    scrapeQueueEvents.off("completed", onCompleted);
    scrapeQueueEvents.off("failed", onFailed);
    res.end();
  };

  // 2 minute timeout — don't keep SSE open forever
  const timeout = setTimeout(cleanup, 120_000);

  res.on("close", () => {
    clearTimeout(timeout);
    clearInterval(heartbeat);
    scrapeQueueEvents.off("progress", onProgress);
    scrapeQueueEvents.off("completed", onCompleted);
    scrapeQueueEvents.off("failed", onFailed);
  });
}

// GET /api/public/runs — list completed runs
export async function publicListRuns(req: Request, res: Response): Promise<void> {
  try {
    const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit || "24"), 10)));
    const excludeSlug = req.query.excludeSlug ? String(req.query.excludeSlug) : null;
    const filter: Record<string, unknown> = {
      status: { $in: ["completed", "completed_with_warnings"] },
      slug: excludeSlug ? { $nin: [null, excludeSlug] } : { $ne: null },
    };
    if (req.query.category) filter.category = String(req.query.category);
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
        status: (r.status as string) ?? "unknown",
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
    const run = await StyleMdRun.findOne({ slug: req.params.slug, status: { $in: ["completed", "completed_with_warnings"] } })
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
        { $match: { status: { $in: ["completed", "completed_with_warnings"] }, slug: { $ne: null } } },
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

    const existingUser = await User.findOne({ uid: decoded.uid }).lean();
    const isNewUser = !existingUser;

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

    if (isNewUser && user.email) {
      sendWelcomeEmail(user.email, user.name).catch((e) =>
        console.warn("[auth/sync] welcome email failed:", e instanceof Error ? e.message : e),
      );
    }

    res.json({ ok: true, data: { uid: user.uid, email: user.email, name: user.name, role: user.role } });
  } catch {
    res.status(401).json({ ok: false, error: "Invalid or expired session" });
  }
}
