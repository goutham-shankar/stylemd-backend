import type { Request } from "express";
import { verifyIdToken } from "../lib/firebaseAdmin";

/**
 * Extracts and decodes the Firebase ID token from the request's Authorization header.
 * Returns the email of the authenticated user, or undefined if not present or invalid.
 */
export async function getEmailFromRequest(req: Request): Promise<string | undefined> {
  const header = req.headers.authorization || "";
  const idToken = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!idToken) {
    return undefined;
  }

  // Warn clearly if Firebase env vars are missing — common VPS misconfiguration
  if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY) {
    console.warn(
      "[AuthUtil] FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY are not set. " +
      "Cannot verify Bearer token — userEmail will be undefined and scrape-complete emails will not send."
    );
    return undefined;
  }

  try {
    const decoded = await verifyIdToken(idToken);
    return decoded.email || undefined;
  } catch (err) {
    console.warn("[AuthUtil] Failed to decode optional ID token:", err instanceof Error ? err.message : String(err));
    return undefined;
  }
}
