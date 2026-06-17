"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFirebaseAdmin = getFirebaseAdmin;
exports.verifyIdToken = verifyIdToken;
const app_1 = require("firebase-admin/app");
const auth_1 = require("firebase-admin/auth");
let initialized = false;
function getFirebaseAdmin() {
    if (!initialized) {
        const projectId = process.env.FIREBASE_PROJECT_ID;
        const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
        const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
        if (!projectId || !clientEmail || !privateKey) {
            throw new Error("FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY are required");
        }
        (0, app_1.initializeApp)({
            credential: (0, app_1.cert)({ projectId, clientEmail, privateKey }),
        });
        initialized = true;
    }
    return (0, app_1.getApp)();
}
async function verifyIdToken(token) {
    getFirebaseAdmin();
    return (0, auth_1.getAuth)().verifyIdToken(token);
}
