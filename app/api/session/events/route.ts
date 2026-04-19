import { createSessionEventStreamResponse } from "@/lib/stream/stylemdEventStream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return createSessionEventStreamResponse();
}
