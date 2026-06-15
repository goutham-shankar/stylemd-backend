import type { Request, Response, NextFunction } from "express";

/**
 * Minimal admin gate — checks Authorization: Bearer <ADMIN_TOKEN>.
 * Set ADMIN_TOKEN in env to a strong random string.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const token = process.env.ADMIN_TOKEN;
  if (!token) {
    res.status(503).json({ ok: false, error: "Admin disabled: set ADMIN_TOKEN" });
    return;
  }
  const header = req.headers.authorization || "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (provided !== token) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }
  next();
}
