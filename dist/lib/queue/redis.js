"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.connection = void 0;
const ioredis_1 = __importDefault(require("ioredis"));
const url = process.env.REDIS_URL;
if (!url) {
    throw new Error("REDIS_URL environment variable is required. Example: redis://default:<password>@127.0.0.1:6379");
}
const opts = {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: false,
};
exports.connection = new ioredis_1.default(url, opts);
exports.connection.on("error", (err) => {
    console.error("[redis] connection error:", err.message);
});
exports.connection.on("ready", () => {
    console.log("[redis] connected");
});
