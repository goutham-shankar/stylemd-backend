import { initializeApp, getApp, cert, App } from "firebase-admin/app";
import { getAuth, DecodedIdToken } from "firebase-admin/auth";

let initialized = false;

export function getFirebaseAdmin(): App {
  if (!initialized) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

    if (!projectId || !clientEmail || !privateKey) {
      throw new Error(
        "FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY are required",
      );
    }

    initializeApp({
      credential: cert({ projectId, clientEmail, privateKey }),
    });
    initialized = true;
  }
  return getApp();
}

export async function verifyIdToken(token: string): Promise<DecodedIdToken> {
  getFirebaseAdmin();
  return getAuth().verifyIdToken(token);
}
