// HVA-45: shared types for the WhatsApp provider abstraction.

/** Variable parameter for a template component. Maps to Meta WhatsApp
 *  Business API's parameter object (Libromi passes through verbatim). */
export type TemplateParameter =
  | { type: 'text'; text: string }
  | { type: 'image'; image: { link: string } }
  | { type: 'document'; document: { link: string; filename?: string } }
  | { type: 'video'; video: { link: string } };

/** One component slot in a template (header / body / footer / button). */
export interface TemplateComponent {
  type: 'header' | 'body' | 'footer' | 'button';
  sub_type?: 'url' | 'quick_reply' | 'catalog';
  index?: string;
  parameters?: TemplateParameter[];
}

/** Full template message — what HVA-46/47 composers produce. */
export interface TemplateMessage {
  /** Pre-approved template name (Meta WABA registered). */
  name: string;
  /** ISO 639-1 + country (e.g. 'en', 'en_US', 'hi'). */
  language: { code: string };
  /** Header / body / button parameter slots. Omit if template has no
   *  variables. */
  components?: TemplateComponent[];
}

/** What the engine hands the provider. */
export interface WhatsAppSendInput {
  /** Recipient phone number, E.164 (e.g. +919876543210). */
  to: string;
  template: TemplateMessage;
}

/** Provider response. Mirrors `AdapterResult` shape so the channel adapter
 *  can return it verbatim. */
export type WhatsAppSendResult =
  | { status: 'delivered'; externalId: string }
  | { status: 'failed'; error: string };

/** WhatsApp provider contract. Every provider (libromi, stub, future
 *  BSPs) implements this. */
export interface WhatsAppProvider {
  /** Name for logs + diagnostics. */
  readonly name: string;
  send(input: WhatsAppSendInput): Promise<WhatsAppSendResult>;
}
