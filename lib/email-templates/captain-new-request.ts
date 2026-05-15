import { escapeText, renderHtml, type RenderedEmail } from './_layout';

// HVA-40 scaffold; consumer wires up in HVA-47 (captain "you have a new
// incoming request" notification). The deep link lands on the captain
// dashboard from HVA-78.

export interface CaptainNewRequestInput {
  captainName: string;
  customerName: string;
  city: string;
  bhk: string;
  requestUrl: string;
}

export function captainNewRequest({
  captainName,
  customerName,
  city,
  bhk,
  requestUrl,
}: CaptainNewRequestInput): RenderedEmail {
  const subject = `New visit request in ${city}`;
  const bodyHtml = `
    <p style="margin:0 0 12px 0;">Hi ${escapeText(captainName)},</p>
    <p style="margin:0 0 12px 0;">
      A new home-visit request has come in for your city.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0"
           style="border-collapse:collapse;margin:0 0 16px 0;font-size:14px;">
      <tr>
        <td style="padding:4px 12px 4px 0;color:#6b7280;">Customer</td>
        <td style="padding:4px 0;">${escapeText(customerName)}</td>
      </tr>
      <tr>
        <td style="padding:4px 12px 4px 0;color:#6b7280;">City</td>
        <td style="padding:4px 0;">${escapeText(city)}</td>
      </tr>
      <tr>
        <td style="padding:4px 12px 4px 0;color:#6b7280;">Home size</td>
        <td style="padding:4px 0;">${escapeText(bhk)}</td>
      </tr>
    </table>
    <p style="margin:0 0 12px 0;">
      Open the request to assign it to a sales executive on your team.
    </p>
  `;
  const html = renderHtml({
    preheader: `New visit request in ${city}`,
    bodyHtml,
    ctaLabel: 'Open in Beakn',
    ctaUrl: requestUrl,
  });

  const text = [
    `Hi ${captainName},`,
    '',
    `A new home-visit request has come in for your city.`,
    ``,
    `Customer:  ${customerName}`,
    `City:      ${city}`,
    `Home size: ${bhk}`,
    '',
    `Open the request to assign it:`,
    requestUrl,
    '',
    '— Beakn',
  ].join('\n');

  return { subject, html, text };
}
