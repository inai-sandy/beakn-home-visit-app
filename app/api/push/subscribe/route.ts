import { and, eq, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/db/client';
import { pushSubscriptions } from '@/db/schema';
import { getServerSession } from '@/lib/auth-server';
import { log } from '@/lib/logger';

// HVA-54: POST = upsert a Web Push subscription for the caller.
//         DELETE = remove a Web Push subscription by endpoint.
//
// The browser's PushManager.subscribe() returns a PushSubscription object
// that serialises to { endpoint, keys: { p256dh, auth } }. We split that
// into discrete columns server-side because (a) it's cheaper to query and
// (b) the JSONB shape is opaque to indexes.
//
// Re-subscribing from the same browser yields the SAME endpoint; the
// ON CONFLICT updates last_used_at + the keys (which can rotate on browser
// reinstall).

export const dynamic = 'force-dynamic';

const subscribeBodySchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

const unsubscribeBodySchema = z.object({
  endpoint: z.string().url(),
});

export async function POST(request: Request): Promise<NextResponse> {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  let parsed: z.infer<typeof subscribeBodySchema>;
  try {
    parsed = subscribeBodySchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'bad_request' },
      { status: 400 },
    );
  }

  const userAgent = request.headers.get('user-agent');
  try {
    await db
      .insert(pushSubscriptions)
      .values({
        userId: session.user.id,
        endpoint: parsed.endpoint,
        p256dh: parsed.keys.p256dh,
        auth: parsed.keys.auth,
        userAgent: userAgent ?? null,
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: {
          // Endpoint re-subscribed — update the keys (can rotate on browser
          // reinstall) and bump last_used_at. The user_id ALSO updates so a
          // device that gets handed off to another user re-attributes
          // correctly.
          userId: session.user.id,
          p256dh: parsed.keys.p256dh,
          auth: parsed.keys.auth,
          lastUsedAt: sql`NOW()`,
          userAgent: userAgent ?? null,
        },
      });
  } catch (err) {
    log.error(
      { err: err instanceof Error ? err.message : String(err), userId: session.user.id },
      'push_subscribe_insert_failed',
    );
    return NextResponse.json({ error: 'persist_failed' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request): Promise<NextResponse> {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  let parsed: z.infer<typeof unsubscribeBodySchema>;
  try {
    parsed = unsubscribeBodySchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'bad_request' },
      { status: 400 },
    );
  }

  // Caller-scoped delete — a malicious endpoint from another user no-ops.
  await db
    .delete(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.endpoint, parsed.endpoint),
        eq(pushSubscriptions.userId, session.user.id),
      ),
    );
  return NextResponse.json({ ok: true });
}
