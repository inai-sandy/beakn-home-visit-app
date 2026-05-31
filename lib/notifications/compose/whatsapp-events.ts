import type { TemplateMessage } from '@/lib/whatsapp';

// =============================================================================
// HVA-45: WhatsApp composer registry
// =============================================================================
//
// Mirrors the IN_APP_COMPOSERS registry shape. Each composer takes the
// dispatch context (event type, target phone, raw context map, template
// key from the rule) and returns a Meta-shaped TemplateMessage with the
// variable parameters populated.
//
// Per-event composers live in their own files (e.g.
// `request-submitted-customer-wa.ts`) and register here. HVA-46/47 add
// the first two:
//   - request.submitted  → customer tracking-link template
//   - request.status_changed → customer status-update template
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

/** Add an entry per event type as HVA-46/47 land. Empty default keeps
 *  the channel adapter's `no_whatsapp_composer_for_X` path intact for
 *  any event with a WhatsApp rule but no composer yet. */
export const WHATSAPP_COMPOSERS: Record<string, WhatsAppComposer> = {};
