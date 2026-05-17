import { sendEmail } from '@/lib/email';

import { EMAIL_COMPOSERS } from '../compose';

import type { AdapterArgs, AdapterResult } from './in-app';

// =============================================================================
// HVA-48: email channel adapter
// =============================================================================
//
// Thin wrapper around lib/email.ts > sendEmail. `target` is the
// recipient email address (string). Composer renders subject + bodyText
// + bodyHtml for the eventType. Adapter forwards templateName for log
// correlation in lib/email.ts.
//
// lib/email.ts > sendEmail is itself fire-and-forget-safe: it never
// throws and returns { ok, messageId } | { ok:false, error }. This
// adapter just maps that to AdapterResult.
// =============================================================================

export async function sendViaEmail(args: AdapterArgs): Promise<AdapterResult> {
  const composer = EMAIL_COMPOSERS[args.eventType];
  if (!composer) {
    return { status: 'failed', error: `no_email_composer_for_${args.eventType}` };
  }

  let body: ReturnType<typeof composer>;
  try {
    body = composer(args.context);
  } catch (err) {
    return {
      status: 'failed',
      error: err instanceof Error ? err.message : 'composer_threw',
    };
  }

  const result = await sendEmail({
    to: args.target,
    subject: body.subject,
    text: body.bodyText,
    html: body.bodyHtml,
    templateName: `engine.${args.eventType}`,
  });

  if (result.ok) {
    return { status: 'delivered', externalId: result.messageId };
  }
  return { status: 'failed', error: result.error };
}
