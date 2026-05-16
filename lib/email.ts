import { createTransport, type Transporter } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';

import { log } from '@/lib/logger';

// =============================================================================
// HVA-40: SMTP transactional email service
// =============================================================================
//
// Single send surface for the whole app. Consumers import sendEmail and pass
// a template-produced { subject, html, text } payload.
//
// SMTP target: Hostinger shared mail, smtp.hostinger.com:465 with implicit TLS
// (NOT 587 STARTTLS — the Linear body says 587, the operator's verified
// working config is 465). secure:true is non-optional here; setting it to
// false on port 465 would attempt plain TCP and Hostinger drops the
// connection.
//
// LAZY TRANSPORTER: mirrors the db/client.ts Proxy pattern. We can't init at
// module load because `next build` page-data collection imports this file
// and SMTP_* env vars aren't required to be present at build time. First
// real send call constructs the transporter; subsequent calls reuse it.
//
// RATE LIMIT: Hostinger shared plans cap around 100 emails/hour. No
// in-process rate limiter here — HVA-48's notification engine will own
// queueing + backoff. Don't add ad-hoc throttling that the engine would
// then duplicate.
//
// NEVER THROW: sendEmail returns { ok, ... } and logs failures. Callers
// (HVA-42 customer confirmation, HVA-47 captain notification, etc.) are
// fire-and-forget from the user's perspective; an SMTP outage must not
// 500 a customer's request submission.
// =============================================================================

const emailLog = log.child({ component: 'email' });

let cached: Transporter | null = null;

function getTransporter(): Transporter {
  if (cached) return cached;

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? '465');
  const secure = (process.env.SMTP_SECURE ?? 'true').toLowerCase() === 'true';
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error(
      'SMTP env vars missing: require SMTP_HOST, SMTP_USER, SMTP_PASS (and optionally SMTP_PORT, SMTP_SECURE).',
    );
  }

  const smtpOptions: SMTPTransport.Options = {
    host,
    port,
    secure,
    auth: { user, pass },
    // No pooling: Phase 1 volume is low and pooled connections complicate
    // container restarts. Default for SMTPTransport is no pool.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  };
  cached = createTransport(smtpOptions);

  return cached;
}

function formatFrom(): string {
  const addr = process.env.SMTP_FROM ?? 'visits@beakn.in';
  const name = process.env.SMTP_FROM_NAME?.trim();
  if (!name) return addr;
  // RFC 5322 display-name with quoted local-part to handle any future
  // names with internal spaces or commas.
  return `"${name.replace(/"/g, '\\"')}" <${addr}>`;
}

/**
 * Redact a recipient address for log output: keep the first letter of the
 * local-part and the full domain, drop the rest. "alice@example.com" →
 * "a***@example.com". For logs only — the real address goes on the wire.
 */
function redactRecipient(to: string): string {
  const at = to.indexOf('@');
  if (at <= 0) return '***';
  const first = to[0] ?? '*';
  const domain = to.slice(at);
  return `${first}***${domain}`;
}

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  /**
   * Optional BCC recipients. Used by HVA-42 routing to broadcast unrouted
   * + "Other"-city requests to every active super_admin without exposing
   * the list to the visible To. Each address counts toward the same
   * Hostinger rate-limit envelope as a To recipient.
   */
  bcc?: string[];
  /** Optional override for Reply-To. Defaults to SMTP_REPLY_TO env. */
  replyTo?: string;
  /**
   * Optional template tag for log correlation. Set by template-wrapping
   * helpers (HVA-42 etc.); not visible to recipients.
   */
  templateName?: string;
  /** Optional request id for log correlation. */
  requestId?: string;
}

export type SendEmailResult =
  | { ok: true; messageId: string }
  | { ok: false; error: string };

/**
 * Send a single transactional email. Never throws; returns ok+messageId or
 * ok:false+error. Logs every attempt + outcome via pino.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const { to, subject, html, text, bcc, replyTo, templateName, requestId } = input;
  const redactedTo = redactRecipient(to);
  const startedAt = Date.now();
  const childLog = emailLog.child({
    requestId,
    template: templateName,
    to: redactedTo,
    bccCount: bcc?.length ?? 0,
  });

  childLog.info({ subject }, 'email_send_attempt');

  let transporter: Transporter;
  try {
    transporter = getTransporter();
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    childLog.error({ error }, 'email_transporter_init_failed');
    return { ok: false, error };
  }

  try {
    const result = await transporter.sendMail({
      from: formatFrom(),
      to,
      bcc: bcc && bcc.length > 0 ? bcc : undefined,
      subject,
      html,
      text,
      replyTo: replyTo ?? process.env.SMTP_REPLY_TO ?? undefined,
    });
    const ms = Date.now() - startedAt;
    childLog.info(
      { messageId: result.messageId, accepted: result.accepted, rejected: result.rejected, ms },
      'email_send_ok',
    );
    return { ok: true, messageId: result.messageId };
  } catch (err) {
    const ms = Date.now() - startedAt;
    const error = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: string } | null)?.code;
    childLog.error({ error, code, ms }, 'email_send_failed');
    return { ok: false, error };
  }
}
