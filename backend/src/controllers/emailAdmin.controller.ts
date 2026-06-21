import type { Request, Response } from "express";
import { Resend } from "resend";

let _resend: Resend | null = null;
function resend(): Resend {
  if (_resend) return _resend;
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is required");
  _resend = new Resend(key);
  return _resend;
}

export async function listEmails(req: Request, res: Response): Promise<void> {
  const after = req.query.after as string | undefined;
  const result = await resend().emails.list(after ? { after } : undefined);

  if (result.error) {
    res.status(502).json({ ok: false, error: result.error.message });
    return;
  }

  res.json({ ok: true, data: result.data });
}

export async function getEmail(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const result = await resend().emails.get(id);

  if (result.error) {
    res.status(502).json({ ok: false, error: result.error.message });
    return;
  }

  res.json({ ok: true, data: result.data });
}

export async function sendTestEmail(req: Request, res: Response): Promise<void> {
  const { to } = req.body as { to?: string };
  if (!to) {
    res.status(400).json({ ok: false, error: "to is required" });
    return;
  }

  const result = await resend().emails.send({
    from: "getmd <hello@getmd.design>",
    to,
    subject: "Test email from Design Probe Admin",
    html: "<p>This is a test email sent from the admin dashboard.</p>",
  });

  if (result.error) {
    res.status(502).json({ ok: false, error: result.error.message });
    return;
  }

  res.json({ ok: true, data: result.data });
}
