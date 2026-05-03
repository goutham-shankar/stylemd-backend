"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSessionEventStreamResponse = createSessionEventStreamResponse;
const stylemdSessionStore_1 = require("@/lib/store/stylemdSessionStore");
const encoder = new TextEncoder();
function serializeEnvelope(envelope) {
    return encoder.encode(`data: ${JSON.stringify(envelope)}\n\n`);
}
function createSessionEventStreamResponse() {
    let unsubscribe = null;
    let heartbeat = null;
    const stream = new ReadableStream({
        start(controller) {
            controller.enqueue(serializeEnvelope((0, stylemdSessionStore_1.buildStateSyncEnvelope)()));
            unsubscribe = (0, stylemdSessionStore_1.subscribeToEvents)((envelope) => {
                controller.enqueue(serializeEnvelope(envelope));
            });
            heartbeat = setInterval(() => {
                controller.enqueue(encoder.encode(": keepalive\n\n"));
            }, 15000);
        },
        cancel() {
            if (heartbeat) {
                clearInterval(heartbeat);
            }
            unsubscribe?.();
        },
    });
    return new Response(stream, {
        headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
        },
    });
}
