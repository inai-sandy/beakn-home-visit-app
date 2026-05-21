import type { NextRequest } from 'next/server';

import { rollOverPendingTasks } from '@/lib/cron/roll-over-tasks';
import { log } from '@/lib/logger';

// =============================================================================
// HVA-169: GET /api/cron/roll-over-tasks
// =============================================================================
//
// Cron-fired endpoint. Host crontab on the VPS (user `beakn`) installs the
// 21:31 IST line — see docs/cron.md.
//
// Auth: `Authorization: Bearer <CRON_SECRET>` header. If CRON_SECRET is
// unset in the environment the route refuses ALL requests with 401 — we
// must not become an open endpoint by accident if someone forgets to set
// the secret post-deploy. (The deploy script's post-flight check emits a
// loud warning when this is missing.)
//
// Returns 200 with { rolledOver, auditWritten } on success so the cron
// line can pipe to logger / mailer if the operator wants metrics.
// =============================================================================

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length === 0) {
    log.error(
      { component: 'cron.roll-over-tasks' },
      'CRON_SECRET_unset_refusing_request',
    );
    return new Response('Unauthorized', { status: 401 });
  }
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const result = await rollOverPendingTasks();
    return Response.json(result);
  } catch (err) {
    log.error(
      {
        component: 'cron.roll-over-tasks',
        err: err instanceof Error ? err : String(err),
      },
      'roll_over_failed',
    );
    return new Response('Internal Server Error', { status: 500 });
  }
}
