import type { NextRequest } from 'next/server';

import { autoCloseStaleDayPlans } from '@/lib/cron/auto-close-day';
import { log } from '@/lib/logger';

// =============================================================================
// HVA-293: GET /api/cron/auto-close-day
// =============================================================================
//
// Cron-fired endpoint. Host crontab on the VPS (user `beakn`) installs the
// 23:55 IST (18:25 UTC) line — see docs/cron.md. Seals any day plan still
// open for today or earlier so a busy exec who never closes still ends the
// day; unupdated tasks stay 'pending'.
//
// Auth: `Authorization: Bearer <CRON_SECRET>`. Refuses ALL requests with
// 401 when CRON_SECRET is unset, so a missing secret can't open the
// endpoint. Mirrors /api/cron/roll-over-tasks exactly.
// =============================================================================

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length === 0) {
    log.error(
      { component: 'cron.auto-close-day' },
      'CRON_SECRET_unset_refusing_request',
    );
    return new Response('Unauthorized', { status: 401 });
  }
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const result = await autoCloseStaleDayPlans();
    return Response.json(result);
  } catch (err) {
    log.error(
      {
        component: 'cron.auto-close-day',
        err: err instanceof Error ? err : String(err),
      },
      'auto_close_day_failed',
    );
    return new Response('Internal Server Error', { status: 500 });
  }
}
