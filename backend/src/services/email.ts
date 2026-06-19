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

export function canSend(): boolean {
  return !!process.env.RESEND_API_KEY;
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
  if (!canSend()) return;
  const label = site.title || site.hostname;
  const html = await render(ScrapeCompleteEmail(site));
  await resend().emails.send({
    from: FROM,
    to,
    subject: `Your DESIGN.md for ${label} is ready ✨`,
    html,
  });
}
