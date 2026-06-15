import { Queue, QueueEvents } from "bullmq";
import { connection } from "./redis";
import { SCRAPE_QUEUE } from "./types";

export const scrapeQueue = new Queue(SCRAPE_QUEUE, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 15_000 },
    removeOnComplete: { age: 86_400, count: 500 },
    removeOnFail: false,
  },
});

export const scrapeQueueEvents = new QueueEvents(SCRAPE_QUEUE, { connection });
