import mongoose from 'mongoose';

interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

declare global {
  var mongooseCache: MongooseCache | undefined;
}

mongoose.connection.on('error', (err) => {
  console.error('Mongoose connection error:', err);
});
mongoose.connection.on('disconnected', () => {
  console.error('Mongoose disconnected');
});

let cached: MongooseCache = globalThis.mongooseCache ?? { conn: null, promise: null };
globalThis.mongooseCache = cached;

export async function connectMongo() {
  if (cached.conn) {
    return cached.conn;
  }

  const MONGO_URI = process.env.MONGO_URI;
  if (!MONGO_URI) {
    throw new Error("MONGO_URI environment variable is required. Set it in your .env.local file.");
  }

  if (!cached.promise) {
    cached.promise = mongoose.connect(MONGO_URI, {
      dbName: 'stylemd',
      serverSelectionTimeoutMS: 60000,
      socketTimeoutMS: 45000,
      tls: true,
    }).then((mongoose) => {
      return mongoose;
    });
  }

  cached.conn = await cached.promise;
  return cached.conn;
}
