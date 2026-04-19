import { NextResponse } from "next/server";
import { resetStyleMdSessionState } from "@/lib/store/stylemdSessionStore";

export const runtime = "nodejs";

export async function POST(): Promise<NextResponse> {
  try {
    resetStyleMdSessionState("Session reset by user.");
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: 500 },
    );
  }
}
