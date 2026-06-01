import { toIst } from '@/lib/date';

import type { TemplateMessage } from '@/lib/whatsapp';

// =============================================================================
// HVA-45 / HVA-46 / HVA-47: WhatsApp composer registry
// =============================================================================
//
// Mirrors the IN_APP_COMPOSERS registry shape. Each composer takes the
// dispatch context (event type, target phone, raw context map, template
// key from the rule) and returns a Meta-shaped TemplateMessage with the
// variable parameters populated.
//
// All 8 customer-facing templates registered in HVA-46/47 are body-only,
// Utility category, English. The body params map onto Meta's numbered
// placeholders ({{1}}, {{2}}, ...) — composer order matters.
//
// Composers are intentionally permissive: a missing field falls back to a
// sensible default so the WhatsApp send still goes through (the engine
// logs a soft warning via the channel adapter). They never throw.
// =============================================================================

export interface WhatsAppComposerArgs {
  /** Recipient phone number, E.164. */
  target: string;
  /** Engine-passed context map. Each composer reads the keys it needs
   *  and falls back gracefully if a field is missing (returns a sensible
   *  default so the send still goes; doesn't throw). */
  context: Record<string, unknown>;
  /** notification_rules.template_key — the Meta-approved template name
   *  to send. Composers read this so the rule can pick which template
   *  to use without a code change. */
  templateKey: string | null;
}

export type WhatsAppComposer = (args: WhatsAppComposerArgs) => TemplateMessage;

// -----------------------------------------------------------------------------
// Shared helpers
// -----------------------------------------------------------------------------

const TRACK_BASE_URL = 'https://visits.beakn.in/track';

function readString(ctx: Record<string, unknown>, key: string, fallback = ''): string {
  const v = ctx[key];
  return typeof v === 'string' && v.length > 0 ? v : fallback;
}

function trackingUrl(ctx: Record<string, unknown>): string {
  const token = readString(ctx, 'trackingToken');
  return token.length > 0 ? `${TRACK_BASE_URL}/${token}` : TRACK_BASE_URL;
}

function bodyParams(values: string[]): TemplateMessage['components'] {
  return [
    {
      type: 'body',
      parameters: values.map((text) => ({ type: 'text' as const, text })),
    },
  ];
}

function customerName(ctx: Record<string, unknown>): string {
  return readString(ctx, 'customerName', 'there');
}

function visitMoment(ctx: Record<string, unknown>, key: string): string {
  const iso = readString(ctx, key);
  if (!iso) return 'the scheduled time';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'the scheduled time';
  return toIst(d);
}

// -----------------------------------------------------------------------------
// Per-event composers — one per Meta template
// -----------------------------------------------------------------------------

// Template 1: tracking_link_confirmation — {{1}}=customerName, {{2}}=trackingUrl
const trackingLinkConfirmation: WhatsAppComposer = ({ templateKey, context }) => ({
  name: templateKey ?? 'tracking_link_confirmation',
  language: { code: 'en' },
  components: bodyParams([customerName(context), trackingUrl(context)]),
});

// Template 2: visit_scheduled — {{1}}=customerName, {{2}}=visit IST, {{3}}=trackingUrl
const visitScheduled: WhatsAppComposer = ({ templateKey, context }) => ({
  name: templateKey ?? 'visit_scheduled',
  language: { code: 'en' },
  components: bodyParams([
    customerName(context),
    visitMoment(context, 'visitScheduledAt'),
    trackingUrl(context),
  ]),
});

// Template 3: visit_rescheduled — {{1}}=customerName, {{2}}=new visit IST, {{3}}=trackingUrl
const visitRescheduled: WhatsAppComposer = ({ templateKey, context }) => ({
  name: templateKey ?? 'visit_rescheduled',
  language: { code: 'en' },
  components: bodyParams([
    customerName(context),
    visitMoment(context, 'toVisitScheduledAt'),
    trackingUrl(context),
  ]),
});

// Template 4: quotation_ready — {{1}}=customerName, {{2}}=trackingUrl
const quotationReady: WhatsAppComposer = ({ templateKey, context }) => ({
  name: templateKey ?? 'quotation_ready',
  language: { code: 'en' },
  components: bodyParams([customerName(context), trackingUrl(context)]),
});

// Template 5: order_confirmed — {{1}}=customerName, {{2}}=trackingUrl
const orderConfirmed: WhatsAppComposer = ({ templateKey, context }) => ({
  name: templateKey ?? 'order_confirmed',
  language: { code: 'en' },
  components: bodyParams([customerName(context), trackingUrl(context)]),
});

// Template 6: installation_complete — {{1}}=customerName, {{2}}=trackingUrl
const installationComplete: WhatsAppComposer = ({ templateKey, context }) => ({
  name: templateKey ?? 'installation_complete',
  language: { code: 'en' },
  components: bodyParams([customerName(context), trackingUrl(context)]),
});

// Template 7: customer_cancellation_received — {{1}}=customerName, {{2}}=trackingUrl
const customerCancellationReceived: WhatsAppComposer = ({ templateKey, context }) => ({
  name: templateKey ?? 'customer_cancellation_received',
  language: { code: 'en' },
  components: bodyParams([customerName(context), trackingUrl(context)]),
});

// Template 8: we_had_to_cancel — {{1}}=customerName, {{2}}=customer support phone
// `supportPhone` comes through context (resolved at dispatch site from
// getConfig('customer_support_phone')) so this composer stays sync.
const weHadToCancel: WhatsAppComposer = ({ templateKey, context }) => ({
  name: templateKey ?? 'we_had_to_cancel',
  language: { code: 'en' },
  components: bodyParams([
    customerName(context),
    readString(context, 'supportPhone', '+91 98856 98665'),
  ]),
});

// -----------------------------------------------------------------------------
// Registry — keyed by event_type
// -----------------------------------------------------------------------------

export const WHATSAPP_COMPOSERS: Record<string, WhatsAppComposer> = {
  'request.created': trackingLinkConfirmation,
  'request.scheduled': visitScheduled,
  'request.rescheduled': visitRescheduled,
  'request.quotation_submitted': quotationReady,
  'request.order_confirmed': orderConfirmed,
  'request.installation_complete': installationComplete,
  'request.cancelled_by_customer': customerCancellationReceived,
  'request.rejected': weHadToCancel,
};
