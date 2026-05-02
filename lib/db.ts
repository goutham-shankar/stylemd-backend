import mongoose from 'mongoose';

interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

declare global {
  var mongoose: MongooseCache | undefined;
}

let dbCache: MongooseCache = globalThis.mongoose ?? { conn: null, promise: null };
globalThis.mongoose = dbCache;

async function connectToDatabase() {
  if (dbCache.conn) {
    return dbCache.conn;
  }

  const MONGO_URI = process.env.MONGO_URI;
  if (!MONGO_URI) {
    throw new Error("MONGO_URI environment variable is required. Set it in your .env.local file.");
  }

  if (!dbCache.promise) {
    const opts = {
      bufferCommands: false,
      dbName: 'stylemd',
      autoIndex: true,
    };

    dbCache.promise = mongoose.connect(MONGO_URI, opts).then((mongoose) => {
      console.log('[db] connected to MongoDB');
      return mongoose;
    });
  }

  try {
    dbCache.conn = await dbCache.promise;
  } catch (e) {
    dbCache.conn = null;
    throw e;
  }

  return dbCache.conn;
}

export default connectToDatabase;
