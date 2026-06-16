"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scrapeQueueEvents = exports.scrapeQueue = void 0;
const bullmq_1 = require("bullmq");
const redis_1 = require("./redis");
const types_1 = require("./types");
exports.scrapeQueue = new bullmq_1.Queue(types_1.SCRAPE_QUEUE, {
    connection: redis_1.connection,
    defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 15000 },
        removeOnComplete: { age: 86400, count: 500 },
        removeOnFail: false,
    },
});
exports.scrapeQueueEvents = new bullmq_1.QueueEvents(types_1.SCRAPE_QUEUE, { connection: redis_1.connection });
