import type { NextRequest } from 'next/server';

import { escalateStaleApprovals } from '@/lib/cron/escalate-stale-approvals';
import { log } from '@/lib/logger';

// =============================================================================
// HVA-224: GET /api/cron/escalate-stale-approvals
// =============================================================================
//
// Hourly cron. CRON_SECRET-gated. See lib/cron/escalate-stale-approvals.ts
// for the business logic + dedup semantics.
// =============================================================================

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length === 0) {
    log.error(
      { component: 'cron.escalate-stale-approvals' },
      'CRON_SECRET_unset_refusing_request',
    );
    return new Response('Unauthorized', { status: 401 });
  }
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const result = await escalateStaleApprovals();
    return Response.json(result);
  } catch (err) {
    log.error(
      {
        component: 'cron.escalate-stale-approvals',
        err: err instanceof Error ? err : String(err),
      },
      'escalation_failed',
    );
    return new Response('Internal Server Error', { status: 500 });
  }
}
