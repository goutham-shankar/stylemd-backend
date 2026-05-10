"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.connectDB = connectDB;
exports.safeWrite = safeWrite;
exports.mongoKeepAlive = mongoKeepAlive;
const mongoose_1 = __importDefault(require("mongoose"));
const promises_1 = __importDefault(require("node:dns/promises"));
const node_url_1 = require("node:url");
let connectingPromise = null;
let lastLogTime = 0;
const LOG_COOLDOWN = 30000; // 30s cooldown for repetitive connection logs
let connectionAttemptCount = 0;
const globalWithMongoose = global;
/**
 * Step 5: Clean logging
 * Log connections clearly, but suppress rapid disconnected/reconnected spam.
 */
function shouldLog() {
    const now = Date.now();
    if (now - lastLogTime > LOG_COOLDOWN) {
        lastLogTime = now;
        return true;
    }
    return false;
}
mongoose_1.default.connection.on("connected", () => {
    if (shouldLog()) {
        console.log("[MONGO] connected");
    }
});
mongoose_1.default.connection.on("disconnected", () => {
    if (shouldLog()) {
        console.error("[MONGO] disconnected");
    }
});
mongoose_1.default.connection.on("error", (err) => {
    console.error("[MONGO] connection error:", err);
});
/**
 * Step 4: Network Diagnostic Log
 */
async function logNetworkDiagnostics(uri) {
    try {
        const parsed = new node_url_1.URL(uri.includes("://") ? uri : `mongodb://${uri}`);
        const host = parsed.hostname;
        const ips = await promises_1.default.resolve4(host).catch(() => []);
        console.log(`[MONGO DIAGNOSTIC] Host: ${host}, IPs: ${ips.join(", ") || "none"}`);
    }
    catch (e) {
        // Ignore diagnostic failures
    }
}
async function connectDB() {
    if (mongoose_1.default.connection.readyState === 1)
        return;
    if (connectingPromise)
        return connectingPromise;
    const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!MONGO_URI) {
        throw new Error("MONGO_URI is not defined in environment variables");
    }
    connectionAttemptCount++;
    console.log(`[MONGO] connection attempt #${connectionAttemptCount}`);
    await logNetworkDiagnostics(MONGO_URI);
    connectingPromise = mongoose_1.default.connect(MONGO_URI, {
        serverSelectionTimeoutMS: 10000,
        socketTimeoutMS: 120000,
        dbName: 'stylemd',
    });
    try {
        await connectingPromise;
        connectingPromise = null;
        globalWithMongoose.mongooseConn = true;
    }
    catch (err) {
        connectingPromise = null;
        console.error("[MONGO] connection failed:", err);
        throw err;
    }
}
/**
 * Step 3: Reconnect before every write
 * Step 4: Improved Write Retry
 * On failure, explicitly attempt a re-connection before the retry.
 */
async function safeWrite(fn) {
    // Step 3: Ensure connection before attempting write
    if (mongoose_1.default.connection.readyState !== 1) {
        try {
            await connectDB();
        }
        catch (e) {
            console.warn("[MONGO] Pre-write reconnect failed, attempting write anyway...");
        }
    }
    for (let i = 0; i < 2; i++) {
        try {
            return await fn();
        }
        catch (err) {
            if (i === 1) {
                console.error(`[MONGO] write failed after ${i + 1} attempts:`, err);
                throw err;
            }
            console.warn(`[MONGO] write attempt ${i + 1} failed, attempting reconnect before retry...`);
            try {
                await connectDB();
            }
            catch (connErr) {
                console.error("[MONGO] reconnect failed during write retry:", connErr);
            }
            await new Promise(r => setTimeout(r, 1000)); // Increased delay for network stability
        }
    }
    throw new Error("Safe write failed");
}
/**
 * Step 1: Improved Keep-Alive Ping
 * Uses a real collection query instead of admin().ping() for better reliability.
 */
async function mongoKeepAlive() {
    try {
        if (mongoose_1.default.connection.readyState === 1) {
            // Use a real collection query to ensure the pool is actually healthy
            await mongoose_1.default.connection.db.collection("stylemd_runs")
                .findOne({}, { projection: { _id: 1 } });
            return true;
        }
    }
    catch (e) {
        console.warn("[MONGO] keepalive ping failed");
    }
    return false;
}
