"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSessionEvents = getSessionEvents;
exports.resetSession = resetSession;
const stylemdEventStream_1 = require("../../../lib/stream/stylemdEventStream");
const stylemdSessionStore_1 = require("../../../lib/store/stylemdSessionStore");
async function getSessionEvents(_req, res) {
    console.log("[SSE] Client connected to /api/session/events");
    const webResponse = (0, stylemdEventStream_1.createSessionEventStreamResponse)();
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    console.log("[SSE] Heartbeat started (10s interval)");
    const heartbeat = setInterval(() => {
        res.write(": ping\n\n");
    }, 10000);
    const reader = webResponse.body.getReader();
    const pump = async () => {
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                const canContinue = res.write(value);
                if (!canContinue) {
                    await new Promise((resolve) => res.once("drain", resolve));
                }
            }
        }
        catch {
            // ignore
        }
        finally {
            res.end();
        }
    };
    res.on("close", () => {
        console.log("[SSE] Client disconnected");
        clearInterval(heartbeat);
        console.log("[SSE] Heartbeat cleaned up");
        reader.cancel().catch(() => undefined);
    });
    void pump();
}
async function resetSession(_req, res) {
    try {
        (0, stylemdSessionStore_1.resetStyleMdSessionState)("Session reset by user.");
        res.json({ ok: true, data: null });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ ok: false, error: message });
    }
}
