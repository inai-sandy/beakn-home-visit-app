import { NextResponse } from 'next/server';
import { z } from 'zod';

import { rescheduleByCustomerAction } from '@/lib/reschedule/actions';

// =============================================================================
// HVA-72: POST /api/track/[token]/reschedule — customer-initiated reschedule
// =============================================================================
//
// Mirrors the HVA-39 cancel endpoint shape. Token in URL is the
// credential; no session check. Delegates to rescheduleByCustomerAction
// which validates + writes + emits notification.
// =============================================================================

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
