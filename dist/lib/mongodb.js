"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.connectMongo = connectMongo;
const mongoose_1 = __importDefault(require("mongoose"));
mongoose_1.default.connection.on('error', (err) => {
    console.error('Mongoose connection error:', err);
});
mongoose_1.default.connection.on('disconnected', () => {
    console.error('Mongoose disconnected');
});
let cached = globalThis.mongooseCache ?? { conn: null, promise: null };
globalThis.mongooseCache = cached;
async function connectMongo() {
    if (cached.conn) {
        return cached.conn;
    }
    const MONGO_URI = process.env.MONGO_URI;
    if (!MONGO_URI) {
        throw new Error("MONGO_URI environment variable is required. Set it in your .env.local file.");
    }
    if (!cached.promise) {
        cached.promise = mongoose_1.default.connect(MONGO_URI, {
            dbName: 'stylemd',
            serverSelectionTimeoutMS: 60000,
            socketTimeoutMS: 45000,
            family: 4, // Use IPv4, skip trying IPv6
        }).then((mongoose) => {
            return mongoose;
        });
    }
    cached.conn = await cached.promise;
    return cached.conn;
}
