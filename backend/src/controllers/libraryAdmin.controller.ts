import type { Request, Response } from "express";
import { DesignLibrary } from "../models/DesignLibrary";
import { canonicalPageUrl } from "@/lib/services/pageUrlCanonical";

export async function listLibraryEntries(_req: Request, res: Response): Promise<void> {
  try {
    const entries = await DesignLibrary.find({}).sort({ createdAt: -1 }).lean();
    res.json({ ok: true, data: entries });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

export async function createLibraryEntry(req: Request, res: Response): Promise<void> {
  try {
    const raw = (req.body as Record<string, string>).url;
    const { label, designMd, notes } = req.body as Record<string, string>;
    if (!raw || !designMd) {
      res.status(400).json({ ok: false, error: "url and designMd are required" });
      return;
    }
    let url: string;
    try { url = canonicalPageUrl(raw); } catch { url = raw.trim(); }
    const addedBy = (req as any).uid ?? null;
    const entry = await DesignLibrary.findOneAndUpdate(
      { url },
      {
        $set: { url, label: label ?? null, designMd, notes: notes ?? null, active: true, addedBy, updatedAt: new Date() },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true, new: true },
    );
    res.json({ ok: true, data: entry });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

export async function updateLibraryEntry(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const allowed = ["label", "designMd", "notes", "active"] as const;
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const key of allowed) {
      if (key in req.body) patch[key] = req.body[key];
    }
    const entry = await DesignLibrary.findByIdAndUpdate(id, { $set: patch }, { new: true });
    if (!entry) { res.status(404).json({ ok: false, error: "not found" }); return; }
    res.json({ ok: true, data: entry });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

export async function deleteLibraryEntry(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    await DesignLibrary.findByIdAndDelete(id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}
