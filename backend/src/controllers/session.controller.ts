import type { Request, Response } from "express";
import { createSessionEventStreamResponse } from "@/lib/stream/stylemdEventStream";
import { resetStyleMdSessionState } from "@/lib/store/stylemdSessionStore";

export async function getSessionEvents(_req: Request, res: Response): Promise<void> {
  const webResponse = createSessionEventStreamResponse();

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const reader = (webResponse.body as ReadableStream<Uint8Array>).getReader();

  const pump = async (): Promise<void> => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const canContinue = res.write(value);
        if (!canContinue) {
          await new Promise<void>((resolve) => res.once("drain", resolve));
        }
      }
    } catch {
      // ignore
    } finally {
      res.end();
    }
  };

  res.on("close", () => {
    reader.cancel().catch(() => undefined);
  });

  void pump();
}

export async function resetSession(_req: Request, res: Response): Promise<void> {
  try {
    resetStyleMdSessionState("Session reset by user.");
    res.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message });
  }
}
