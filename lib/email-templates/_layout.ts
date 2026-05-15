// =============================================================================
// HVA-40: shared HTML wrapper for transactional emails
// =============================================================================
//
// Tiny inline-styled scaffold matching the Beakn web brand at a low-fi level
// (Inter-ish system stack, neutral palette, rounded card). Email-safe means
// table-based layout + inline styles; we use a single max-width container
// with simple block styles that render acceptably in Gmail, Outlook desktop,
// iOS Mail, and most webmail providers.
//
// All templates compose two outputs: { subject, html, text }. Plain-text
// alternate is non-negotiable for deliverability — spam filters score lower
// when only HTML is present.
// =============================================================================

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const BRAND_NAME = 'Beakn';
const BRAND_TAGLINE = 'Home visit & consultation scheduling';

interface LayoutInput {
  preheader: string;
  bodyHtml: string;
  ctaLabel?: string;
  ctaUrl?: string;
  footerNote?: string;
}

export function renderHtml({
  preheader,
  bodyHtml,
  ctaLabel,
  ctaUrl,
  footerNote,
}: LayoutInput): string {
  const cta =
    ctaLabel && ctaUrl
      ? `
      <tr>
        <td style="padding: 24px 32px 8px 32px;">
          <a href="${escapeAttr(ctaUrl)}"
             style="display:inline-block;padding:12px 22px;background:#111827;color:#ffffff;text-decoration:none;border-radius:10px;font-weight:600;font-size:15px;">
            ${escapeText(ctaLabel)}
          </a>
        </td>
      </tr>`
      : '';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeText(BRAND_NAME)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;">
    <span style="display:none;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all;">
      ${escapeText(preheader)}
    </span>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f3f4f6;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;background:#ffffff;border-radius:16px;border:1px solid #e5e7eb;overflow:hidden;">
            <tr>
              <td style="padding:28px 32px 8px 32px;">
                <div style="font-size:13px;font-weight:600;letter-spacing:0.08em;color:#6b7280;text-transform:uppercase;">
                  ${escapeText(BRAND_NAME)}
                </div>
                <div style="font-size:12px;color:#9ca3af;margin-top:2px;">
                  ${escapeText(BRAND_TAGLINE)}
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 16px 32px;font-size:15px;line-height:1.6;color:#111827;">
                ${bodyHtml}
              </td>
            </tr>
            ${cta}
            <tr>
              <td style="padding:24px 32px 28px 32px;border-top:1px solid #f3f4f6;font-size:12px;color:#6b7280;line-height:1.5;">
                ${footerNote ? `<div style="margin-bottom:8px;">${escapeText(footerNote)}</div>` : ''}
                <div>
                  You're receiving this because you (or someone on your behalf) requested a home visit through Beakn. Reply to this email if anything looks wrong.
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function escapeText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeAttr(s: string): string {
  return escapeText(s);
}
