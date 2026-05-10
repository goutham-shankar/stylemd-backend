import mongoose from "mongoose";
import dns from "node:dns/promises";
import { URL } from "node:url";

let connectingPromise: Promise<typeof mongoose> | null = null;
let lastLogTime = 0;
const LOG_COOLDOWN = 30000; // 30s cooldown for repetitive connection logs
let connectionAttemptCount = 0;

const globalWithMongoose = global as typeof global & {
  mongooseConn?: boolean;
};

/**
 * Step 5: Clean logging
 * Log connections clearly, but suppress rapid disconnected/reconnected spam.
 */
function shouldLog(): boolean {
  const now = Date.now();
  if (now - lastLogTime > LOG_COOLDOWN) {
    lastLogTime = now;
    return true;
  }
  return false;
}

mongoose.connection.on("connected", () => {
  if (shouldLog()) {
    console.log("[MONGO] connected");
  }
});

mongoose.connection.on("disconnected", () => {
  if (shouldLog()) {
    console.error("[MONGO] disconnected");
  }
});

mongoose.connection.on("error", (err) => {
  console.error("[MONGO] connection error:", err);
});

/**
 * Step 4: Network Diagnostic Log
 */
async function logNetworkDiagnostics(uri: string) {
  try {
    const parsed = new URL(uri.includes("://") ? uri : `mongodb://${uri}`);
    const host = parsed.hostname;
    const ips = await dns.resolve4(host).catch(() => []);
    console.log(`[MONGO DIAGNOSTIC] Host: ${host}, IPs: ${ips.join(", ") || "none"}`);
  } catch (e) {
    // Ignore diagnostic failures
  }
}

export async function connectDB() {
  if (mongoose.connection.readyState === 1) return;

  if (connectingPromise) return connectingPromise;

  const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

  if (!MONGO_URI) {
    throw new Error("MONGO_URI is not defined in environment variables");
  }

  connectionAttemptCount++;
  console.log(`[MONGO] connection attempt #${connectionAttemptCount}`);
  await logNetworkDiagnostics(MONGO_URI);

  connectingPromise = mongoose.connect(MONGO_URI, {
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 120000,
    dbName: 'stylemd',
  });

  try {
    await connectingPromise;
    connectingPromise = null;
    globalWithMongoose.mongooseConn = true;
  } catch (err) {
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
export async function safeWrite<T>(fn: () => Promise<T>): Promise<T> {
  // Step 3: Ensure connection before attempting write
  if (mongoose.connection.readyState !== 1) {
    try {
      await connectDB();
    } catch (e) {
      console.warn("[MONGO] Pre-write reconnect failed, attempting write anyway...");
    }
  }

  for (let i = 0; i < 2; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === 1) {
        console.error(`[MONGO] write failed after ${i + 1} attempts:`, err);
        throw err;
      }
      
      console.warn(`[MONGO] write attempt ${i + 1} failed, attempting reconnect before retry...`);
      
      try {
        await connectDB();
      } catch (connErr) {
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
export async function mongoKeepAlive() {
  try {
    if (mongoose.connection.readyState === 1) {
      // Use a real collection query to ensure the pool is actually healthy
      await mongoose.connection.db.collection("stylemd_runs")
        .findOne({}, { projection: { _id: 1 } });
      return true;
    }
  } catch (e) {
    console.warn("[MONGO] keepalive ping failed");
  }
  return false;
}
