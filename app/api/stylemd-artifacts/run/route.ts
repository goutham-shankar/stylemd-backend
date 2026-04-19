import { NextResponse } from "next/server";
import { z } from "zod";
import { validateStyleMdProviderCredentials } from "@/lib/stylemd-artifacts/provider";
import { getActiveStyleMdRunId, startStyleMdRun } from "@/lib/stylemd-artifacts/runManager";

export const runtime = "nodejs";

const requestSchema = z.object({
  url: z.string().url(),
  provider: z.enum(["claude", "kimi"]).optional().default("claude"),
});

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { url, provider } = requestSchema.parse(body);

    const credentialError = validateStyleMdProviderCredentials(provider);
    if (credentialError) {
      return NextResponse.json(
        {
          ok: false,
          error: credentialError,
        },
        { status: 400 },
      );
    }

    const activeRunId = getActiveStyleMdRunId();
    if (activeRunId) {
      return NextResponse.json(
        {
          ok: false,
          error: `A style artifact run is already active: ${activeRunId}`,
        },
        { status: 409 },
      );
    }

    const { runId } = await startStyleMdRun(url, provider);
    return NextResponse.json({ ok: true, runId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
