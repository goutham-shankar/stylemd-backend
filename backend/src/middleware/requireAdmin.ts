import type { Request, Response, NextFunction } from "express";
import { verifyIdToken } from "../lib/firebaseAdmin";
import { User } from "../models/User";

// Comma-separated list of emails that are always granted admin on first login.
// Override via BOOTSTRAP_ADMINS env var.
const BOOTSTRAP_ADMINS = (
  process.env.BOOTSTRAP_ADMINS ?? "gouthamsankarv@gmail.com"
)
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export interface AdminRequest extends Request {
  adminUser?: {
    uid: string;
    email: string;
    name: string;
    photoURL?: string;
    role: "admin" | "user";
  };
}

// requireAuth: verifies token + upserts user, but does NOT check role.
// Use for endpoints that non-admin signed-in users need (e.g. /me).
export async function requireAuth(
  req: AdminRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.headers.authorization || "";
  const idToken = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!idToken) {
    res.status(401).json({ ok: false, error: "Unauthorized: no token" });
    return;
  }

  try {
    const decoded = await verifyIdToken(idToken);
    const isBootstrapAdmin = BOOTSTRAP_ADMINS.includes(
      (decoded.email ?? "").toLowerCase(),
    );

    const user = await User.findOneAndUpdate(
      { uid: decoded.uid },
      {
        $set: {
          email: decoded.email ?? "",
          name: decoded.name ?? decoded.email ?? "Unknown",
          photoURL: decoded.picture ?? undefined,
          lastLoginAt: new Date(),
          ...(isBootstrapAdmin ? { role: "admin" } : {}),
        },
        // Only set role on insert when $set isn't already setting it —
        // having the same path in both $set and $setOnInsert causes a conflict.
        $setOnInsert: isBootstrapAdmin ? {} : { role: "user" },
      },
      { upsert: true, new: true },
    );

    req.adminUser = {
      uid: decoded.uid,
      email: decoded.email ?? "",
      name: decoded.name ?? "",
      photoURL: decoded.picture,
      role: user.role,
    };

    next();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(401).json({ ok: false, error: `Unauthorized: ${msg}` });
  }
}

export async function requireAdmin(
  req: AdminRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.headers.authorization || "";
  const idToken = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!idToken) {
    res.status(401).json({ ok: false, error: "Unauthorized: no token" });
    return;
  }

  try {
    const decoded = await verifyIdToken(idToken);

    const isBootstrapAdmin = BOOTSTRAP_ADMINS.includes(
      (decoded.email ?? "").toLowerCase(),
    );

    // Upsert user in MongoDB on every login.
    // Bootstrap admins always get/keep the admin role.
    const updateDoc: any = {
      $set: {
        email: decoded.email ?? "",
        name: decoded.name ?? decoded.email ?? "Unknown",
        photoURL: decoded.picture ?? undefined,
        lastLoginAt: new Date(),
      },
    };

    if (isBootstrapAdmin) {
      updateDoc.$set.role = "admin";
    } else {
      updateDoc.$setOnInsert = { role: "user" };
    }

    const user = await User.findOneAndUpdate(
      { uid: decoded.uid },
      updateDoc,
      { upsert: true, new: true },
    );

    // Only admins may access admin-protected routes.
    if (user.role !== "admin") {
      res.status(403).json({ ok: false, error: "Forbidden: admin access required" });
      return;
    }

    req.adminUser = {
      uid: decoded.uid,
      email: decoded.email ?? "",
      name: decoded.name ?? "",
      photoURL: decoded.picture,
      role: user.role,
    };

    next();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(401).json({ ok: false, error: `Unauthorized: ${msg}` });
  }
}
