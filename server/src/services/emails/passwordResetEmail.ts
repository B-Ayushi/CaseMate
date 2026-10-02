import type { MailMessage } from '../../lib/mailer.js';
import { escapeHtml } from './layout.js';

export function passwordResetEmail(params: {
  to: string;
  name: string;
  resetUrl: string;
  expiresInMinutes: number;
}): MailMessage {
  const { to, name, resetUrl, expiresInMinutes } = params;

  const text = [
    `Hello ${name},`,
    '',
    'We received a request to reset the password for your CaseMate account.',
    `Open this link within ${expiresInMinutes} minutes to choose a new password:`,
    '',
    resetUrl,
    '',
    'If you did not ask for this, you can ignore this email. Your password will not change.',
    '',
    'CaseMate',
  ].join('\n');

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#f8fafc;font-family:Segoe UI,Arial,sans-serif;color:#0f172a">
    <div style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:24px">
      <h1 style="font-size:20px;margin:0 0 16px">Reset your CaseMate password</h1>
      <p>Hello ${escapeHtml(name)},</p>
      <p>We received a request to reset the password for your CaseMate account. This link works for ${expiresInMinutes} minutes.</p>
      <p style="margin:24px 0">
        <a href="${escapeHtml(resetUrl)}" style="background:#0f172a;color:#ffffff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">Choose a new password</a>
      </p>
      <p style="font-size:14px;color:#475569">If the button does not work, copy this link into your browser:<br><span style="word-break:break-all">${escapeHtml(resetUrl)}</span></p>
      <p style="font-size:14px;color:#475569">If you did not ask for this, you can ignore this email. Your password will not change.</p>
    </div>
  </body>
</html>`;

  return { to, subject: 'Reset your CaseMate password', text, html };
}
