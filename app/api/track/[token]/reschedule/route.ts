import { headers as headersFn } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { checkTokenRateLimit } from '@/lib/rate-limit';
import { rescheduleByCustomerAction } from '@/lib/reschedule/actions';

// =============================================================================
// HVA-72: POST /api/track/[token]/reschedule — customer-initiated reschedule
// =============================================================================
//
// Mirrors the HVA-39 cancel endpoint shape. Token in URL is the
// credential; no session check. Delegates to rescheduleByCustomerAction
// which validates + writes + emits notification.
// =============================================================================

// HVA-322: generous enough that no real customer meets it — the business cap
// (HVA-320) stops them at 3 successful changes long before this — but tight
// enough that a leaked link cannot be used to hammer the team with
// notifications.
const RATE_LIMIT_WINDOW = '24 hours';
const RATE_LIMIT_MAX = 10;

const paramsSchema = z.object({
  token: z.string().min(8).max(64),
});

const bodySchema = z.object({
  toVisitScheduledAt: z.string(),
  reason: z.string().optional(),
});

interface Ctx {
  params: Promise<{ token: string }>;
}

export async function POST(req: Request, ctx: Ctx): Promise<NextResponse> {
  const paramsParsed = paramsSchema.safeParse(await ctx.params);
  if (!paramsParsed.success) {
    return NextResponse.json(
      { ok: false, error: 'Invalid token' },
      { status: 400 },
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid JSON' },
      { status: 400 },
    );
  }
  const bodyParsed = bodySchema.safeParse(raw);
  if (!bodyParsed.success) {
    return NextResponse.json(
      { ok: false, error: 'Invalid input' },
      { status: 400 },
    );
  }

  // HVA-322: this endpoint has no session — the token in the URL is the only
  // credential — so without a quota a tracking link is unlimited attempts.
  // HVA-320 capped how many reschedules can SUCCEED; nothing capped how many
  // could be tried, and each accepted one fires a customer WhatsApp plus
  // in-app and push to the captain, the assigned exec and every super_admin.
  //
  // Checked BEFORE the action runs, so a rejected attempt writes nothing and
  // notifies nobody.
  const reqHeaders = await headersFn();
  const rate = await checkTokenRateLimit({
    scope: 'track_reschedule',
    token: paramsParsed.data.token,
    window: RATE_LIMIT_WINDOW,
    max: RATE_LIMIT_MAX,
    ipAddress:
      reqHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
  });
  if (!rate.ok) {
    // Fail CLOSED on a DB error. A rate limiter that quietly stops limiting
    // is worse than a visible outage, because nothing reveals it.
    if (rate.reason === 'unavailable') {
      return NextResponse.json(
        {
          ok: false,
          error: 'Service temporarily unavailable. Please try again shortly.',
        },
        { status: 503 },
      );
    }
    return NextResponse.json(
      {
        ok: false,
        error:
          'Too many reschedule attempts for this request today. Please try again tomorrow, or call your executive.',
      },
      { status: 429 },
    );
  }

  const result = await rescheduleByCustomerAction({
    token: paramsParsed.data.token,
    toVisitScheduledAt: bodyParsed.data.toVisitScheduledAt,
    reason: bodyParsed.data.reason,
  });
  if (!result.ok) {
    return NextResponse.json(result, { status: 409 });
  }
  return NextResponse.json(result, { status: 200 });
}
