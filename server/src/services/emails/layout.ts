export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// The shared frame for every CaseMate email. `bodyHtml` must already be escaped.
export function emailLayout(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#f8fafc;font-family:Segoe UI,Arial,sans-serif;color:#0f172a">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:24px">
      <h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(title)}</h1>
      ${bodyHtml}
      <p style="margin-top:24px;font-size:12px;color:#64748b">Sent by CaseMate. All times are Indian Standard Time.</p>
    </div>
  </body>
</html>`;
}

export function buttonHtml(href: string, label: string): string {
  return `<p style="margin:24px 0"><a href="${escapeHtml(href)}" style="background:#4338ca;color:#ffffff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">${escapeHtml(label)}</a></p>`;
}
