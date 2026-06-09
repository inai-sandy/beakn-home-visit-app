import { and, eq, gte, sql } from 'drizzle-orm';
import { headers as headersFn } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/db/client';
import {
  rateLimitAttempts,
  supportTickets,
  visitRequests,
} from '@/db/schema';
import { logEvent } from '@/lib/audit';
import { log } from '@/lib/logger';
import { dispatchNotification } from '@/lib/notifications/engine';
import { verifyTurnstile } from '@/lib/turnstile';

// =============================================================================
// HVA-254 (HVA-232 Phase 1): public ticket intake
// =============================================================================
//
// POST /api/customer/support-tickets
//
// Anyone with a valid tracking_token can submit. Defences:
//   1. Zod-validate body shape + length bounds
//   2. Rate-limit: max 5 tickets per tracking_token per 24h (rate_limit_attempts)
//   3. Cloudflare Turnstile (HVA-34 pattern) — server-side verify
//   4. Visit-request lookup by token; 404 on miss
//
// On success: writes the ticket, audits, fires notification fan-out, 200.
// Notification engine swallows its own errors; ticket persistence is the
// source of truth for "did the customer submit?".
// =============================================================================

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const routeLog = log.child({ component: 'customer.support-tickets' });

const RATE_LIMIT_KEY_PREFIX = 'support_ticket';
const RATE_LIMIT_WINDOW = '24 hours';
const RATE_LIMIT_MAX = 5;

const bodySchema = z.object({
  trackingToken: z.string().min(8).max(32),
  subject: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(2000),
  category: z.enum(['complaint', 'warranty', 'refund', 'other']),
  turnstileToken: z.string().min(1),
});

export async function POST(req: Request): Promise<NextResponse> {
  // ----- 1. Parse body -----
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid JSON' },
      { status: 400 },
    );
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    routeLog.warn(
      { issues: parsed.error.issues.map((i) => i.message) },
      'support_ticket_validation_failed',
    );
    return NextResponse.json(
      {
        ok: false,
        error: parsed.error.issues[0]?.message ?? 'Invalid input',
      },
      { status: 400 },
    );
  }

  const ip = (await headersFn()).get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';

  // ----- 2. Rate-limit per tracking_token -----
  //
  // Key on the token (not just the IP) — multiple legitimate customers
  // share NAT but each gets their own quota via their unique token.
  const key = `${RATE_LIMIT_KEY_PREFIX}:${parsed.data.trackingToken}`;
  let attemptsInWindow = 0;
  try {
    attemptsInWindow = await db.transaction(async (tx) => {
      await tx.execute(
        sql`DELETE FROM rate_limit_attempts WHERE attempted_at < now() - interval '24 hours'`,
      );
      const [{ n }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(rateLimitAttempts)
        .where(
          and(
            sql`${rateLimitAttempts.key} = ${key}`,
            gte(
              rateLimitAttempts.attemptedAt,
              sql`now() - interval ${sql.raw(`'${RATE_LIMIT_WINDOW}'`)}`,
            ),
          ),
        );
      await tx.insert(rateLimitAttempts).values({ key, ipAddress: ip });
      return n;
    });
  } catch (err) {
    routeLog.error(
      { err: err instanceof Error ? err.message : String(err) },
      'support_ticket_rate_limit_db_error',
    );
    return NextResponse.json(
      {
        ok: false,
        error: 'Service temporarily unavailable. Please try again shortly.',
      },
      { status: 503 },
    );
  }
  if (attemptsInWindow >= RATE_LIMIT_MAX) {
    routeLog.warn({ attemptsInWindow, key }, 'support_ticket_rate_limited');
    return NextResponse.json(
      {
        ok: false,
        error: 'You\'ve raised the maximum number of tickets for this order today. Please try again tomorrow.',
      },
      { status: 429 },
    );
  }

  // ----- 3. Turnstile -----
  const turnstile = await verifyTurnstile(parsed.data.turnstileToken, ip);
  if (!turnstile.success) {
    routeLog.warn(
      { errorCodes: turnstile.errorCodes ?? [] },
      'support_ticket_turnstile_failed',
    );
    return NextResponse.json(
      { ok: false, error: 'Verification failed. Please retry the challenge.' },
      { status: 400 },
    );
  }

  // ----- 4. Resolve visit_request by tracking_token -----
  const [reqRow] = await db
    .select({
      id: visitRequests.id,
      customerName: visitRequests.customerName,
      customerPhone: visitRequests.customerPhone,
      assignedExecUserId: visitRequests.assignedExecUserId,
      assignedCaptainUserId: visitRequests.assignedCaptainUserId,
      cityId: visitRequests.cityId,
    })
    .from(visitRequests)
    .where(eq(visitRequests.trackingToken, parsed.data.trackingToken))
    .limit(1);
  if (!reqRow) {
    return NextResponse.json(
      { ok: false, error: 'Order not found' },
      { status: 404 },
    );
  }

  // ----- 5. INSERT ticket + audit + notify -----
  const [created] = await db
    .insert(supportTickets)
    .values({
      requestId: reqRow.id,
      category: parsed.data.category,
      subject: parsed.data.subject,
      description: parsed.data.description,
      status: 'open',
      customerNameSnapshot: reqRow.customerName,
      customerPhoneSnapshot: reqRow.customerPhone,
    })
    .returning({ id: supportTickets.id });

  await logEvent({
    eventType: 'support_ticket_created',
    actorUserId: null,
    targetEntityType: 'support_ticket',
    targetEntityId: created.id,
    afterState: {
      requestId: reqRow.id,
      category: parsed.data.category,
      subject: parsed.data.subject,
      status: 'open',
    },
  });

  // Fire-and-forget notification — never block the customer's response.
  try {
    void dispatchNotification('customer.support_ticket_created', {
      ticketId: created.id,
      requestId: reqRow.id,
      customerName: reqRow.customerName,
      customerPhone: reqRow.customerPhone,
      category: parsed.data.category,
      subject: parsed.data.subject,
      cityId: reqRow.cityId,
      execUserId: reqRow.assignedExecUserId,
      captainUserId: reqRow.assignedCaptainUserId,
    });
  } catch (err) {
    routeLog.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'support_ticket_notify_failed',
    );
  }

  routeLog.info(
    {
      ticketId: created.id,
      requestId: reqRow.id,
      category: parsed.data.category,
    },
    'support_ticket_created',
  );

  return NextResponse.json({ ok: true, ticketId: created.id }, { status: 200 });
}
