import { escapeText, renderHtml, type RenderedEmail } from './_layout';

// HVA-40 scaffold; consumer wires up alongside HVA-67 forward-only status
// transitions to notify customers of stage changes (visit scheduled, visit
// completed, etc.). The status string is taken from status_stages.name so
// admin renames flow through automatically.

export interface CustomerStatusUpdateInput {
  customerName: string;
  newStatus: string;
  trackingUrl: string;
  note?: string;
}

export function customerStatusUpdate({
  customerName,
  newStatus,
  trackingUrl,
  note,
}: CustomerStatusUpdateInput): RenderedEmail {
  const subject = `Update on your Beakn visit: ${newStatus}`;
  const bodyHtml = `
    <p style="margin:0 0 12px 0;">Hi ${escapeText(customerName)},</p>
    <p style="margin:0 0 12px 0;">
      Your home-visit request just moved to
      <strong>${escapeText(newStatus)}</strong>.
    </p>
    ${
      note
        ? `<p style="margin:0 0 12px 0;color:#374151;background:#f9fafb;border-left:3px solid #e5e7eb;padding:10px 14px;border-radius:6px;">${escapeText(note)}</p>`
        : ''
    }
    <p style="margin:0 0 12px 0;">
      You can see the full timeline of your request — including who's handling
      it and when the visit is scheduled — on the tracking page.
    </p>
  `;
  const html = renderHtml({
    preheader: `Your visit is now: ${newStatus}`,
    bodyHtml,
    ctaLabel: 'View status',
    ctaUrl: trackingUrl,
  });

  const text = [
    `Hi ${customerName},`,
    '',
    `Your home-visit request just moved to: ${newStatus}.`,
    ...(note ? ['', note] : []),
    '',
    `Full timeline:`,
    trackingUrl,
    '',
    '— Beakn',
  ].join('\n');

  return { subject, html, text };
}
