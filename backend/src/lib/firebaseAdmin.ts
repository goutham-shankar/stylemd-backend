import { initializeApp, getApp as fbGetApp, getApps, cert, type App } from "firebase-admin/app";
import { getAuth, type DecodedIdToken } from "firebase-admin/auth";

function getOrInitApp(): App {
  if (getApps().length) return fbGetApp();

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY are required");
  }

  return initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
}

export function getFirebaseAuth() {
  return getAuth(getOrInitApp());
}

export async function verifyIdToken(token: string): Promise<DecodedIdToken> {
  return getFirebaseAuth().verifyIdToken(token);
}
