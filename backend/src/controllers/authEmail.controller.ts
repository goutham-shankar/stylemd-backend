import type { Request, Response } from "express";
import { getFirebaseAuth } from "../lib/firebaseAdmin";
import { sendSignInEmail } from "../services/email";

export async function sendEmailSignInLink(req: Request, res: Response): Promise<void> {
  const { email } = req.body as { email?: string };
  if (!email || typeof email !== "string") {
    res.status(400).json({ success: false, message: "email is required" });
    return;
  }

  const trimmed = email.trim().toLowerCase();
  const callbackUrl = `${req.headers.origin || process.env.NEXT_PUBLIC_APP_URL || "https://getmd.design"}/auth/callback`;

  try {
    const link = await getFirebaseAuth().generateSignInWithEmailLink(trimmed, {
      url: callbackUrl,
      handleCodeInApp: true,
    });

    await sendSignInEmail(trimmed, link);
  } catch (err) {
    console.error("[auth/send-link]", err instanceof Error ? err.message : err);
  }

  res.json({ success: true, message: "If an account exists, a sign-in link has been sent." });
}
