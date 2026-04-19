import { NextResponse } from "next/server";
import { getStyleMdRunSummary } from "@/lib/stylemd-artifacts/runManager";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ runId: string }> },
): Promise<NextResponse> {
  try {
    const params = await context.params;
    const summary = await getStyleMdRunSummary(params.runId);

    if (!summary) {
      return NextResponse.json({ ok: false, error: "Run summary not found." }, { status: 404 });
    }

    return NextResponse.json({ ok: true, summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
