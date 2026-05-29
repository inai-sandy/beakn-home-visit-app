import { eq } from 'drizzle-orm';
import webpush from 'web-push';

import { db } from '@/db/client';
import { pushSubscriptions } from '@/db/schema';
import { log } from '@/lib/logger';

import { IN_APP_COMPOSERS } from '../compose';

// HVA-54: web_push channel adapter.
//
// Looks up every push_subscriptions row for `target` (the user_id) and fires
// a web-push payload to each. Reuses the IN_APP composers because the
// payload shape (title + body + linkUrl) is identical to what the bell
// drawer displays — keeping a single source of truth so the in-tab toast,
// the bell drawer, and the OS-level browser notification all read the same
// copy.
//
// Failure handling:
//   - 404 / 410 from the push service → subscription is dead, delete the row
//   - Other errors → log and mark failed (engine logs in the queue)
//
// Never throws to caller (engine contract).

export interface AdapterResult {
  status: 'delivered' | 'failed';
  error?: string;
  externalId?: string;
}

export interface AdapterArgs {
  target: string;
  eventType: string;
  context: Record<string, unknown>;
  templateKey: string | null;
}

let vapidConfigured = false;
function ensureVapidConfigured(): boolean {
  if (vapidConfigured) return true;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? 'mailto:admin@beakn.in';
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
  return true;
}

export async function sendViaWebPush(args: AdapterArgs): Promise<AdapterResult> {
  if (!ensureVapidConfigured()) {
    return { status: 'failed', error: 'vapid_not_configured' };
  }
  const composer = IN_APP_COMPOSERS[args.eventType];
  if (!composer) {
    return { status: 'failed', error: `no_composer_for_${args.eventType}` };
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

  const subs = await db
    .select({
      id: pushSubscriptions.id,
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
    })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, args.target));
  if (subs.length === 0) {
    return { status: 'failed', error: 'no_subscriptions' };
  }

  const payload = JSON.stringify({
    title: body.title,
    body: body.body,
    linkUrl: body.linkUrl ?? null,
    eventType: args.eventType,
  });

  let delivered = 0;
  let lastError: string | undefined;
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        payload,
        { TTL: 24 * 60 * 60 },
      );
      delivered += 1;
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      const message = err instanceof Error ? err.message : 'web_push_failed';
      // 404 (Not Found) or 410 (Gone) from the push service = subscription
      // is permanently dead. Clean up so we don't keep dispatching to it.
      if (statusCode === 404 || statusCode === 410) {
        try {
          await db
            .delete(pushSubscriptions)
            .where(eq(pushSubscriptions.id, sub.id));
        } catch (deleteErr) {
          log.warn(
            {
              err:
                deleteErr instanceof Error ? deleteErr.message : String(deleteErr),
              subscriptionId: sub.id,
            },
            'web_push_cleanup_failed',
          );
        }
      }
      lastError = message;
      log.warn(
        { statusCode, err: message, subscriptionId: sub.id },
        'web_push_send_failed',
      );
    }
  }

  if (delivered === 0) {
    return { status: 'failed', error: lastError ?? 'all_subscriptions_failed' };
  }
  return { status: 'delivered', externalId: `pushed_${delivered}_of_${subs.length}` };
}
