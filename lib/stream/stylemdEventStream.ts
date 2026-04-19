import { buildStateSyncEnvelope, subscribeToEvents } from "@/lib/store/stylemdSessionStore";
import type { EventEnvelope } from "@/lib/types/stylemdEvents";

const encoder = new TextEncoder();

function serializeEnvelope(envelope: EventEnvelope): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(envelope)}\n\n`);
}

export function createSessionEventStreamResponse(): Response {
  let unsubscribe: (() => void) | null = null;
  let heartbeat: NodeJS.Timeout | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(serializeEnvelope(buildStateSyncEnvelope()));

      unsubscribe = subscribeToEvents((envelope) => {
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
