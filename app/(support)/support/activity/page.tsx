import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { getIstDateString } from '@/lib/today/time';
import { loadActivityFeed, type ActivityEventType } from '@/lib/support/orders-queries';
import { cn } from '@/lib/utils';

// =============================================================================
// HVA-245: /support/activity — chronological dispatch event feed
// =============================================================================
//
// Server-loads the last 200 dispatch_status_history rows joined with author
// + items. Groups by IST date (Today / Yesterday / earlier date strings).
// Click any row to jump to the corresponding order detail.
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Activity — Support — Beakn',
};

const EVENT_LABEL: Record<ActivityEventType, string> = {
  dispatch_created: 'dispatched',
  dispatch_packed: 'marked packed',
  dispatch_handed_off: 'handed off',
};

const EVENT_TONE: Record<ActivityEventType, string> = {
  dispatch_created: 'bg-amber-500/10 text-amber-700 border-amber-500/30',
  dispatch_packed: 'bg-sky-500/10 text-sky-700 border-sky-500/30',
  dispatch_handed_off: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/30',
};

function dateGroupLabel(istDate: string, todayIst: string): string {
  if (istDate === todayIst) return 'Today';
  // Yesterday: subtract 1 day from todayIst
  const t = new Date(`${todayIst}T00:00:00+05:30`);
  t.setDate(t.getDate() - 1);
  const yIst = t.toISOString().slice(0, 10);
  if (istDate === yIst) return 'Yesterday';
  // Otherwise show DD MMM
  const d = new Date(`${istDate}T00:00:00+05:30`);
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  });
}

function formatTimeIst(when: Date): string {
  return when.toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Kolkata',
  });
}

export default async function SupportActivityPage() {
  const rows = await loadActivityFeed();
  const todayIst = getIstDateString(new Date());

  // Group by IST date
  const byDate = new Map<string, typeof rows>();
  for (const row of rows) {
    const istDate = getIstDateString(row.changedAt);
    const arr = byDate.get(istDate) ?? [];
    arr.push(row);
    byDate.set(istDate, arr);
  }
  const orderedDates = Array.from(byDate.keys()).sort((a, b) =>
    a < b ? 1 : -1,
  );

  return (
    <section className="space-y-4">
      <header>
        <h2 className="text-2xl font-semibold tracking-tight">Activity</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Recent dispatch events across all orders. Grouped by day.
        </p>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-3xl border bg-muted/40 p-10 text-center space-y-3">
          <Icon
            name="history"
            size="lg"
            className="text-muted-foreground/70 mx-auto"
          />
          <p className="text-sm text-muted-foreground">
            No dispatch activity yet.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {orderedDates.map((date) => {
            const events = byDate.get(date)!;
            return (
              <div key={date} className="space-y-2">
                <h3 className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
                  {dateGroupLabel(date, todayIst)}
                </h3>
                <ol className="space-y-2">
                  {events.map((e) => (
                    <li
                      key={e.id}
                      className="rounded-2xl border bg-card px-3 py-2"
                    >
                      <Link
                        href={`/support/orders/${e.requestId}`}
                        className="block hover:bg-muted/40 -mx-1 px-1 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                      >
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <Badge
                            variant="outline"
                            className={cn(
                              'text-[10px]',
                              EVENT_TONE[e.eventType],
                            )}
                          >
                            {EVENT_LABEL[e.eventType]}
                          </Badge>
                          <span className="text-sm">
                            <span className="font-medium">
                              {e.changedByName ?? 'Someone'}
                            </span>{' '}
                            {EVENT_LABEL[e.eventType]} for{' '}
                            <span className="font-medium">{e.customerName}</span>
                          </span>
                          <span className="text-[11px] text-muted-foreground ml-auto">
                            {formatTimeIst(e.changedAt)} · {e.cityName}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {e.itemsSummary}
                        </p>
                      </Link>
                    </li>
                  ))}
                </ol>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
