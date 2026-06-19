import type { Request, Response } from "express";
import { getAuth } from "firebase-admin/auth";
import { User } from "../models/User";
import type { AdminRequest } from "../middleware/requireAdmin";

export async function listUsers(req: Request, res: Response): Promise<void> {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10));
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "50"), 10)));
    const skip = (page - 1) * limit;
    const [users, total] = await Promise.all([
      User.find({}).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      User.countDocuments({}),
    ]);
    res.json({ ok: true, data: users, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

export async function createUser(req: Request, res: Response): Promise<void> {
  try {
    const { email, password, name, role } = req.body as {
      email?: string;
      password?: string;
      name?: string;
      role?: string;
    };

    if (!email || typeof email !== "string") {
      res.status(400).json({ ok: false, error: "email is required" });
      return;
    }
    if (!password || typeof password !== "string" || password.length < 6) {
      res.status(400).json({ ok: false, error: "password is required and must be at least 6 characters" });
      return;
    }

    const assignedRole: "admin" | "user" =
      role === "admin" ? "admin" : "user";

    // Create user in Firebase Auth
    const firebaseUser = await getAuth().createUser({
      email,
      password,
      displayName: name ?? email,
    });

    // Persist in MongoDB
    const user = await User.findOneAndUpdate(
      { uid: firebaseUser.uid },
      {
        $set: {
          email,
          name: name ?? email,
          role: assignedRole,
          lastLoginAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true, new: true },
    );

    res.status(201).json({ ok: true, data: user });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Firebase already-exists error
    if (msg.includes("email-already-exists")) {
      res.status(409).json({ ok: false, error: "A user with that email already exists" });
      return;
    }
    res.status(500).json({ ok: false, error: msg });
  }
}

export async function updateUserRole(req: Request, res: Response): Promise<void> {
  try {
    const { uid } = req.params;
    const { role } = req.body as { role?: string };
    if (role !== "admin" && role !== "user") {
      res.status(400).json({ ok: false, error: "role must be 'admin' or 'user'" });
      return;
    }
    const user = await User.findOneAndUpdate({ uid }, { $set: { role } }, { new: true });
    if (!user) {
      res.status(404).json({ ok: false, error: "User not found" });
      return;
    }
    res.json({ ok: true, data: user });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

export async function deleteUser(req: Request, res: Response): Promise<void> {
  try {
    const { uid } = req.params;
    const me = (req as AdminRequest).adminUser;
    if (me?.uid === uid) {
      res.status(400).json({ ok: false, error: "Cannot delete your own account" });
      return;
    }

    // Remove from Firebase Auth
    await getAuth().deleteUser(uid).catch(() => undefined);

    await User.deleteOne({ uid });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

export async function getMe(req: Request, res: Response): Promise<void> {
  const me = (req as AdminRequest).adminUser;
  res.json({ ok: true, data: me });
}
