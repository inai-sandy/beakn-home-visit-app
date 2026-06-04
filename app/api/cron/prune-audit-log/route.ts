import type { NextRequest } from 'next/server';

import { pruneAuditLog } from '@/lib/cron/prune-audit-log';
import { log } from '@/lib/logger';

// =============================================================================
// HVA-224: GET /api/cron/prune-audit-log
// =============================================================================
//
// Daily cron (02:30 IST). CRON_SECRET-gated. See lib/cron/prune-audit-log.ts
// for the business logic.
// =============================================================================

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length === 0) {
    log.error(
      { component: 'cron.prune-audit-log' },
      'CRON_SECRET_unset_refusing_request',
    );
    return new Response('Unauthorized', { status: 401 });
  }
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const result = await pruneAuditLog();
    return Response.json(result);
  } catch (err) {
    log.error(
      {
        component: 'cron.prune-audit-log',
        err: err instanceof Error ? err : String(err),
      },
      'prune_failed',
    );
    return new Response('Internal Server Error', { status: 500 });
  }
}
