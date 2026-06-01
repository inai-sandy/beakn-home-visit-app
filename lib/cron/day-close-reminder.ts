import { and, eq, isNull } from 'drizzle-orm';

import { db } from '@/db/client';
import { dayPlans } from '@/db/schema';
import { getIstDateString } from '@/lib/today/time';
import { log } from '@/lib/logger';
import { dispatchNotification } from '@/lib/notifications/engine';

// =============================================================================
// HVA-155 Part C: 21:30 IST day-close WhatsApp reminder
// =============================================================================
//
// Fires `cron.day_close_reminder` for every exec whose day plan for today
// (IST) was started but not closed. The notification engine resolves the
// `exec` recipient role to context.execUserId → users.phone, then sends
// the Meta-approved `exec_day_close_reminder` template via Libromi.
//
// Idempotent. Safe to run multiple times — only fires for execs whose
// closedAt is still NULL (and Meta's WABA template-throttling de-dupes
// at the recipient level for repeat sends in a short window).
//
// CRON SCHEDULE (host crontab on VPS, user `beakn`):
//   30 21 * * * curl -sf -H "Authorization: Bearer ${CRON_SECRET}" \
//     http://localhost:3001/api/cron/day-close-reminder
//
// (cron docs in docs/cron.md to be updated alongside this ship)
// =============================================================================

const cronLog = log.child({ component: 'cron.day-close-reminder' });

export interface DayCloseReminderResult {
  istDate: string;
  candidatesFound: number;
  dispatched: number;
}

export async function fireDayCloseReminders(
  now: Date = new Date(),
): Promise<DayCloseReminderResult> {
  const istDate = getIstDateString(now);

  // Find all execs with an open day plan for today.
  const candidates = await db
    .select({ execUserId: dayPlans.execUserId })
    .from(dayPlans)
    .where(and(eq(dayPlans.planDate, istDate), isNull(dayPlans.closedAt)));

  if (candidates.length === 0) {
    cronLog.info({ istDate }, 'no_open_day_plans');
    return { istDate, candidatesFound: 0, dispatched: 0 };
  }

  let dispatched = 0;
  for (const c of candidates) {
    try {
      // Fire and don't block on a single failure — the engine swallows
      // its own adapter failures, but a thrown error here would skip the
      // remaining candidates. Still wrap to be defensive.
      await dispatchNotification('cron.day_close_reminder', {
        execUserId: c.execUserId,
        istDate,
      });
      dispatched += 1;
    } catch (err) {
      cronLog.error(
        {
          execUserId: c.execUserId,
          istDate,
          err: err instanceof Error ? err.message : String(err),
        },
        'dispatch_failed',
      );
    }
  }

  cronLog.info(
    { istDate, candidatesFound: candidates.length, dispatched },
    'day_close_reminders_fired',
  );
  return { istDate, candidatesFound: candidates.length, dispatched };
}
