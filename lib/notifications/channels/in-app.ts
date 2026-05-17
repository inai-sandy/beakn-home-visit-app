import { db } from '@/db/client';
import { inAppNotifications } from '@/db/schema';

import { IN_APP_COMPOSERS } from '../compose';

// =============================================================================
// HVA-48: in-app channel adapter
// =============================================================================
//
// Writes a row into `in_app_notifications` for the target user. The
// table is the source for HVA-52's drawer; the engine treats this as
// just-another-channel even though the read-side is in-app.
//
// `target` is the user_id (uuid). The composer maps eventType → in-app
// body shape (title / body / linkUrl). If no composer is registered for
// the eventType, the adapter returns failed (the engine logs + records
// the failure but does not throw).
//
// Failure modes:
//   - composer missing               → status='failed', error='no_composer'
//   - Drizzle insert throws          → status='failed', error=<msg>
// Never throws to caller (engine contract).
// =============================================================================

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

export async function sendViaInApp(args: AdapterArgs): Promise<AdapterResult> {
  const composer = IN_APP_COMPOSERS[args.eventType];
  if (!composer) {
    return { status: 'failed', error: `no_in_app_composer_for_${args.eventType}` };
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

  try {
    const [row] = await db
      .insert(inAppNotifications)
      .values({
        userId: args.target,
        eventType: args.eventType,
        title: body.title,
        body: body.body,
        linkUrl: body.linkUrl ?? null,
      })
      .returning({ id: inAppNotifications.id });
    return { status: 'delivered', externalId: row.id };
  } catch (err) {
    return {
      status: 'failed',
      error: err instanceof Error ? err.message : 'in_app_insert_failed',
    };
  }
}
