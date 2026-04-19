import { NextResponse } from "next/server";
import { cancelActiveStyleMdRun } from "@/lib/stylemd-artifacts/runManager";

export const runtime = "nodejs";

export async function POST(): Promise<NextResponse> {
  try {
    const result = await cancelActiveStyleMdRun();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
