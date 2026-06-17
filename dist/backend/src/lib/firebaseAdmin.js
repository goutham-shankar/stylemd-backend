"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFirebaseAuth = getFirebaseAuth;
exports.verifyIdToken = verifyIdToken;
const app_1 = require("firebase-admin/app");
const auth_1 = require("firebase-admin/auth");
function getOrInitApp() {
    if ((0, app_1.getApps)().length)
        return (0, app_1.getApp)();
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
    if (!projectId || !clientEmail || !privateKey) {
        throw new Error("FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY are required");
    }
    return (0, app_1.initializeApp)({ credential: (0, app_1.cert)({ projectId, clientEmail, privateKey }) });
}
function getFirebaseAuth() {
    return (0, auth_1.getAuth)(getOrInitApp());
}
async function verifyIdToken(token) {
    return getFirebaseAuth().verifyIdToken(token);
}
