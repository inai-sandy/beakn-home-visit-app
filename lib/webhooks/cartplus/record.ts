import { and, eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { webhookEvents, webhookSecrets } from '@/db/schema';

import { CARTPLUS_PROVIDER } from './envelope';

// =============================================================================
// HVA-249 (HVA-230): persist incoming CartPlus webhook events
// =============================================================================
//
// One row per (provider, provider_event_id) in webhook_events. The UNIQUE
// constraint enforced by migration 0068 gives us free idempotency — a
// retry from CartPlus simply hits the constraint and we return "duplicate"
// without a second row.
//
// Three result paths:
//   - "ok"     — verified, parsed, ready for the handler (HVA-250)
//   - "noop"   — duplicate event ID (idempotency hit)
//   - "error"  — verification/parse/handler failure (dead-letter row)
// =============================================================================

export interface RecordOptions {
  providerEventId: string;
  eventType: string;
  deliveryId: string | null;
  payload: unknown;
  /**
   * Initial result. HVA-249 lands rows with `noop` (the handler isn't
   * wired yet); HVA-250 will switch to `ok` once the handler succeeds.
   */
  initialResult?: 'ok' | 'noop' | 'error';
  errorMessage?: string | null;
}

export interface RecordOutcome {
  status: 'inserted' | 'duplicate';
  webhookEventId: string | null;
  /**
   * HVA-280: on a duplicate, the stored result of the row we collided
   * with. Lets the receiver REPROCESS a previously-failed event instead
   * of blindly returning "noop" — a transient handler failure on the
   * first delivery must not make CartPlus's retry a permanent no-op.
   * Null for inserts (or if the existing row couldn't be re-read).
   */
  existingResult?: 'ok' | 'noop' | 'error' | null;
}

export async function recordCartplusEvent(
  opts: RecordOptions,
): Promise<RecordOutcome> {
  const result = opts.initialResult ?? 'noop';
  const processedAt = result === 'ok' || result === 'noop' ? new Date() : null;

  try {
    const [row] = await db
      .insert(webhookEvents)
      .values({
        provider: CARTPLUS_PROVIDER,
        providerEventId: opts.providerEventId,
        eventType: opts.eventType,
        deliveryId: opts.deliveryId,
        payload: opts.payload as Record<string, unknown>,
        processedAt,
        result,
        errorMessage: opts.errorMessage ?? null,
      })
      .returning({ id: webhookEvents.id });
    return { status: 'inserted', webhookEventId: row.id };
  } catch (err) {
    // Postgres unique_violation on (provider, provider_event_id) is the
    // only error path we treat as "duplicate" — everything else re-throws.
    const sqlState =
      err && typeof err === 'object' && 'cause' in err
        ? (err as { cause?: { code?: string } }).cause?.code
        : undefined;
    const codeFromTopLevel =
      err && typeof err === 'object' && 'code' in err
        ? (err as { code?: string }).code
        : undefined;
    if (sqlState === '23505' || codeFromTopLevel === '23505') {
      // Re-read the row we collided with so the receiver can decide
      // whether to reprocess (prior result='error') or short-circuit
      // (prior result='ok'). Best-effort: if the read fails, fall back
      // to the old "noop" behaviour.
      try {
        const [existing] = await db
          .select({ id: webhookEvents.id, result: webhookEvents.result })
          .from(webhookEvents)
          .where(
            and(
              eq(webhookEvents.provider, CARTPLUS_PROVIDER),
              eq(webhookEvents.providerEventId, opts.providerEventId),
            ),
          )
          .limit(1);
        return {
          status: 'duplicate',
          webhookEventId: existing?.id ?? null,
          existingResult:
            (existing?.result as 'ok' | 'noop' | 'error' | undefined) ?? null,
        };
      } catch {
        return { status: 'duplicate', webhookEventId: null, existingResult: null };
      }
    }
    throw err;
  }
}

/**
 * Bump `webhook_secrets.last_used_at` for the secret that authenticated
 * the request. Fire-and-forget — failure here doesn't fail the webhook.
 */
export async function touchSecretLastUsed(secretId: string): Promise<void> {
  try {
    await db
      .update(webhookSecrets)
      .set({ lastUsedAt: new Date() })
      .where(
        and(
          eq(webhookSecrets.id, secretId),
          eq(webhookSecrets.provider, CARTPLUS_PROVIDER),
        ),
      );
  } catch {
    // best-effort; surfaced via missing `last_used_at` in the admin UI
  }
}
