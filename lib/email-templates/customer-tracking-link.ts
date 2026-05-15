import { escapeText, renderHtml, type RenderedEmail } from './_layout';

// HVA-40 scaffold; consumer wires up in HVA-42 (customer confirmation email
// after request submission). The tracking URL is the customer-facing
// /track/[token] page (HVA-36).

export interface CustomerTrackingLinkInput {
  customerName: string;
  trackingUrl: string;
  city: string;
}

export function customerTrackingLink({
  customerName,
  trackingUrl,
  city,
}: CustomerTrackingLinkInput): RenderedEmail {
  const subject = `Your Beakn visit request is confirmed`;
  const bodyHtml = `
    <p style="margin:0 0 12px 0;">Hi ${escapeText(customerName)},</p>
    <p style="margin:0 0 12px 0;">
      Thanks for booking a home visit with Beakn. We've received your request
      for <strong>${escapeText(city)}</strong> and a city captain will be in
      touch shortly to arrange a convenient time.
    </p>
    <p style="margin:0 0 12px 0;">
      You can check the status of your request at any time using the secure
      link below. No login required — just keep it handy.
    </p>
  `;
  const html = renderHtml({
    preheader: 'Track your Beakn visit request',
    bodyHtml,
    ctaLabel: 'Track my request',
    ctaUrl: trackingUrl,
    footerNote: 'This link is unique to your request. Please don’t share it.',
  });

  const text = [
    `Hi ${customerName},`,
    '',
    `Thanks for booking a home visit with Beakn. We've received your request for ${city} and a city captain will be in touch shortly to arrange a convenient time.`,
    '',
    'Check the status of your request any time at:',
    trackingUrl,
    '',
    'This link is unique to your request — please don’t share it.',
    '',
    '— Beakn',
  ].join('\n');

  return { subject, html, text };
}
