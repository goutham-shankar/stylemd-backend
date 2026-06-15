import IORedis, { type RedisOptions } from "ioredis";

const url = process.env.REDIS_URL;
if (!url) {
  throw new Error(
    "REDIS_URL environment variable is required. Example: redis://default:<password>@127.0.0.1:6379",
  );
}

const opts: RedisOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: false,
};

export const connection = new IORedis(url, opts);

connection.on("error", (err) => {
  console.error("[redis] connection error:", err.message);
});
connection.on("ready", () => {
  console.log("[redis] connected");
});
