import type { NextRequest } from 'next/server';

import { fireDayCloseReminders } from '@/lib/cron/day-close-reminder';
import { log } from '@/lib/logger';

// =============================================================================
// HVA-155 Part C: GET /api/cron/day-close-reminder
// =============================================================================
//
// Cron-fired endpoint. Host crontab on the VPS (user `beakn`) installs the
// 21:30 IST line — see docs/cron.md.
//
// Auth: `Authorization: Bearer <CRON_SECRET>` header. If CRON_SECRET is
// unset the route refuses ALL requests with 401.
// =============================================================================

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length === 0) {
    log.error(
      { component: 'cron.day-close-reminder' },
      'CRON_SECRET_unset_refusing_request',
    );
    return new Response('Unauthorized', { status: 401 });
  }
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const result = await fireDayCloseReminders();
    return Response.json(result);
  } catch (err) {
    log.error(
      {
        component: 'cron.day-close-reminder',
        err: err instanceof Error ? err : String(err),
      },
      'day_close_reminder_failed',
    );
    return new Response('Internal Server Error', { status: 500 });
  }
}
