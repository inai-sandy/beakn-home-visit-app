import { escapeText, renderHtml, type RenderedEmail } from './_layout';

// HVA-40 scaffold extended by HVA-42 routing: takes the full customer
// payload so a captain or super_admin recipient can see everything they
// need without opening the portal. Three routing flavors share this body
// but differ in subject + recipient salutation + flagged-prefix.

export type RoutingFlavor = 'captain' | 'other' | 'unrouted';

export interface CaptainNewRequestInput {
  /** 'captain' | 'other' | 'unrouted' — drives subject prefix + greeting. */
  flavor: RoutingFlavor;
  /** Recipient salutation. Use 'Captain' for the city captain, 'Beakn admin' for super_admins. */
  recipientLabel: string;
  customerName: string;
  /** '+91' prefix + 10 digits (storage form). Will be displayed verbatim. */
  customerPhone: string;
  customerEmail: string | null;
  /** Free-text address as the customer entered it. */
  address: string;
  /** City as the customer selected it from the dropdown (may be 'Other'). */
  city: string;
  /** Free-text state line the customer filled when city was 'Other'. */
  customerState: string | null;
  /** DB-form BHK string ('1BHK', '2BHK', etc.). */
  bhk: string;
  /** Comma-joined interest tags ready for display. */
  interestSummary: string;
  /** IST-localised submission timestamp (e.g. '16 May 2026, 09:14 IST'). */
  submittedAtIst: string;
  /** Full URL the CTA points at. */
  requestUrl: string;
}

function subjectFor(input: CaptainNewRequestInput): string {
  switch (input.flavor) {
    case 'other':
      return `New Home Visit Request — ${input.customerName} (Other City: ${input.city})`;
    case 'unrouted':
      return `[UNROUTED — ${input.city}] New Home Visit Request — ${input.customerName}`;
    case 'captain':
    default:
      return `New Home Visit Request — ${input.customerName}, ${input.city}`;
  }
}

function preambleHtml(input: CaptainNewRequestInput): string {
  switch (input.flavor) {
    case 'other':
      return `
        <p style="margin:0 0 12px 0;">
          A new home-visit request came in for an <strong>uncovered city</strong>.
          The customer chose "Other" — assign it to whichever captain
          should handle it from the admin portal.
        </p>`;
    case 'unrouted':
      return `
        <p style="margin:0 0 8px 0;color:#b91c1c;font-weight:600;">
          ⚠ Routing failed.
        </p>
        <p style="margin:0 0 12px 0;">
          A new home-visit request came in for <strong>${escapeText(input.city)}</strong>,
          but the city has no captain routing email configured. Please set
          a routing email for this city in admin settings, then forward this
          request to the captain.
        </p>`;
    case 'captain':
    default:
      return `
        <p style="margin:0 0 12px 0;">
          A new home-visit request just came in for your city. The customer
          is waiting for a callback to confirm visit timing.
        </p>`;
  }
}

export function captainNewRequest(input: CaptainNewRequestInput): RenderedEmail {
  const subject = subjectFor(input);
  const rows: Array<[string, string]> = [
    ['Customer', input.customerName],
    ['Phone', input.customerPhone],
    ...(input.customerEmail ? [['Email', input.customerEmail] as [string, string]] : []),
    ['City', input.city],
    ...(input.customerState ? [['State', input.customerState] as [string, string]] : []),
    ['Home size', input.bhk],
    ['Address', input.address],
    ['Interested in', input.interestSummary || '—'],
    ['Submitted', input.submittedAtIst],
  ];

  const rowsHtml = rows
    .map(
      ([label, value]) => `
      <tr>
        <td style="padding:4px 12px 4px 0;color:#6b7280;vertical-align:top;white-space:nowrap;">${escapeText(label)}</td>
        <td style="padding:4px 0;vertical-align:top;">${escapeText(value)}</td>
      </tr>`,
    )
    .join('');

  const bodyHtml = `
    <p style="margin:0 0 12px 0;">Hi ${escapeText(input.recipientLabel)},</p>
    ${preambleHtml(input)}
    <table role="presentation" cellpadding="0" cellspacing="0"
           style="border-collapse:collapse;margin:0 0 16px 0;font-size:14px;width:100%;">
      ${rowsHtml}
    </table>
  `;

  const html = renderHtml({
    preheader: subject,
    bodyHtml,
    ctaLabel: 'Open in Admin Portal',
    ctaUrl: input.requestUrl,
  });

  const textLines = [
    `Hi ${input.recipientLabel},`,
    '',
    input.flavor === 'unrouted'
      ? `⚠ Routing failed for ${input.city}.`
      : input.flavor === 'other'
        ? `A new home-visit request came in for an uncovered city.`
        : `A new home-visit request just came in for your city.`,
    '',
    ...rows.map(([label, value]) => `${label.padEnd(13)} ${value}`),
    '',
    `Open in Admin Portal:`,
    input.requestUrl,
    '',
    '— Beakn',
  ];

  return { subject, html, text: textLines.join('\n') };
}
