import { Resend } from "resend";
import { render } from "@react-email/components";
import { MagicLinkEmail } from "../emails/magic-link";
import { WelcomeEmail } from "../emails/welcome";
import { ScrapeCompleteEmail } from "../emails/scrape-complete";

const FROM = "getmd <hello@getmd.design>";

let _resend: Resend | null = null;
function resend(): Resend {
  if (_resend) return _resend;
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is required");
  _resend = new Resend(key);
  return _resend;
}

let _warnedNoKey = false;
export function canSend(): boolean {
  const ok = !!process.env.RESEND_API_KEY;
  if (!ok && !_warnedNoKey) {
    _warnedNoKey = true;
    console.warn("[email] RESEND_API_KEY not set — all emails will be silently skipped");
  }
  return ok;
}

export async function sendSignInEmail(to: string, signInLink: string): Promise<void> {
  if (!canSend()) return;
  const html = await render(MagicLinkEmail({ signInLink }));
  await resend().emails.send({
    from: FROM,
    to,
    subject: "Sign in to getmd.design",
    html,
  });
}

export async function sendWelcomeEmail(to: string, name: string): Promise<void> {
  if (!canSend()) return;
  const html = await render(WelcomeEmail({ name }));
  await resend().emails.send({
    from: FROM,
    to,
    subject: "Welcome to getmd.design",
    html,
  });
}

export async function sendScrapeCompleteEmail(
  to: string,
  site: {
    hostname: string;
    slug: string;
    title?: string | null;
    screenshotUrl?: string | null;
    durationMs?: number | null;
    completedAt?: string | null;
  },
): Promise<void> {
  const tag = `[email:scrape-complete → ${to}]`;

  // ── Step 1: Check RESEND_API_KEY ─────────────────────────────────────────
  console.log(`${tag} ① checking RESEND_API_KEY…`);
  if (!canSend()) {
    console.error(`${tag} ✗ RESEND_API_KEY is not set — email skipped. Add it to your .env file.`);
    return;
  }
  console.log(`${tag} ✓ RESEND_API_KEY present`);

  // ── Step 2: Render HTML template ─────────────────────────────────────────
  console.log(`${tag} ② rendering HTML template for hostname=${site.hostname}…`);
  let html: string;
  try {
    html = await render(ScrapeCompleteEmail(site));
    console.log(`${tag} ✓ template rendered (${html.length} bytes)`);
  } catch (renderErr) {
    console.error(`${tag} ✗ template render failed:`, renderErr instanceof Error ? renderErr.message : renderErr);
    throw renderErr;
  }

  // ── Step 3: Call Resend API ───────────────────────────────────────────────
  const label = site.title || site.hostname;
  const subject = `Your DESIGN.md for ${label} is ready ✨`;
  console.log(`${tag} ③ calling Resend API — from="${FROM}" subject="${subject}"…`);
  try {
    const response = await resend().emails.send({ from: FROM, to, subject, html });
    // Resend SDK returns { data: { id }, error } shape
    const id = (response as any)?.data?.id ?? (response as any)?.id ?? "(no id returned)";
    const apiError = (response as any)?.error;
    if (apiError) {
      console.error(`${tag} ✗ Resend API returned an error: ${JSON.stringify(apiError)}`);
      throw new Error(`Resend API error: ${JSON.stringify(apiError)}`);
    }
    console.log(`${tag} ✓ email accepted by Resend — messageId=${id}`);
  } catch (sendErr) {
    console.error(`${tag} ✗ Resend API call failed:`, sendErr instanceof Error ? sendErr.message : sendErr);
    throw sendErr;
  }
}
