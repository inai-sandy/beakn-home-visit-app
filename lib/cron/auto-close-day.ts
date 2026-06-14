import { and, isNull, lte } from 'drizzle-orm';

import { db } from '@/db/client';
import { dayPlans } from '@/db/schema';
import { log } from '@/lib/logger';
import { getIstDateString } from '@/lib/today/time';

// =============================================================================
// HVA-293: auto-close day plans at 23:55 IST
// =============================================================================
//
// Execs are often too busy to close their day. This cron (host crontab,
// 18:25 UTC = 23:55 IST — see docs/cron.md) seals any day plan that's still
// open for today or earlier, so the day is never left live indefinitely.
//
// What it does NOT do: touch tasks. Whatever the exec didn't update stays
// 'pending' (Sandeep's requirement) — the next day's roll-over cron (21:31)
// then stamps rolled_over_at on those, and they resurface as "recent open
// tasks" the exec can pull into the new day.
//
// `auto_closed = true` marks the seal as automatic vs the exec's manual
// close, for UI/reporting. Sweeps plan_date <= today so a plan left open on
// a prior day (e.g. before this cron existed) also gets sealed.
// =============================================================================

export interface AutoCloseResult {
  autoClosed: number;
}

export async function autoCloseStaleDayPlans(
  now: Date = new Date(),
): Promise<AutoCloseResult> {
  const todayIst = getIstDateString(now);

  const closed = await db
    .update(dayPlans)
    .set({ closedAt: now, autoClosed: true, updatedAt: now })
    .where(
      and(
        isNull(dayPlans.closedAt),
        lte(dayPlans.planDate, todayIst),
      ),
    )
    .returning({ id: dayPlans.id });

  const result: AutoCloseResult = { autoClosed: closed.length };
  log
    .child({ component: 'cron.auto-close-day' })
    .info({ ...result, todayIst }, 'day_plans_auto_closed');
  return result;
}
