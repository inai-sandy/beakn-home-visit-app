import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { formatRupees } from '@/components/today/DayCloseMetricTiles';
import type { ExecBestOfPeriod } from '@/lib/exec/dashboard-queries';

// HVA-155 follow-up: three "best of period" cards for the exec dashboard.
// Single-date mode at the dashboard collapses to the last 7 days ending on
// the picked date and passes that here as the windowLabel.

interface Props {
  data: ExecBestOfPeriod;
  /** Human-readable label for the window the stats cover, shown in the
   *  small caption under each card (e.g. "Last 7 days ending 30 May" or
   *  "1 May – 14 May"). */
  windowLabel: string;
}

export function BestOfPeriodCards({ data, windowLabel }: Props) {
  return (
    <section aria-label="Best of period" className="space-y-3">
      <header>
        <h2 className="text-base font-semibold tracking-tight">Highlights</h2>
        <p className="text-xs text-muted-foreground">{windowLabel}.</p>
      </header>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <BestDayCard data={data.bestDay} />
        <TopCustomerCard data={data.topCustomer} />
        <BestTaskTypeCard data={data.bestTaskType} />
      </div>
    </section>
  );
}

function BestDayCard({ data }: { data: ExecBestOfPeriod['bestDay'] }) {
  return (
    <article className="rounded-2xl border bg-card p-4 space-y-1.5 min-w-0">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon name="emoji_events" size="sm" aria-hidden />
        <p className="text-xs uppercase tracking-wide min-w-0 truncate">
          Best day
        </p>
      </div>
      {data === null ? (
        <EmptyValue />
      ) : (
        <>
          <p className="text-2xl font-semibold tracking-tight tabular-nums truncate">
            {Math.round(data.completionPct)}%
          </p>
          <p className="text-xs text-muted-foreground truncate">
            {formatIstDate(data.date)} · {data.doneCount} of {data.totalCount} done
          </p>
        </>
      )}
    </article>
  );
}

function TopCustomerCard({ data }: { data: ExecBestOfPeriod['topCustomer'] }) {
  return (
    <article className="rounded-2xl border bg-card p-4 space-y-1.5 min-w-0">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon name="person_pin" size="sm" aria-hidden />
        <p className="text-xs uppercase tracking-wide min-w-0 truncate">
          Top customer
        </p>
      </div>
      {data === null ? (
        <EmptyValue />
      ) : (
        <>
          <p className="text-sm font-semibold tracking-tight truncate">
            {data.customerName}
          </p>
          <p className="text-base font-semibold tabular-nums truncate">
            {formatRupees(data.totalCollectedPaise / 100)}
          </p>
          <Badge variant="outline" className="text-[10px] shrink-0">
            {data.paymentCount} payment{data.paymentCount === 1 ? '' : 's'}
          </Badge>
        </>
      )}
    </article>
  );
}

function BestTaskTypeCard({
  data,
}: {
  data: ExecBestOfPeriod['bestTaskType'];
}) {
  return (
    <article className="rounded-2xl border bg-card p-4 space-y-1.5 min-w-0">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon name="trending_up" size="sm" aria-hidden />
        <p className="text-xs uppercase tracking-wide min-w-0 truncate">
          Best task type
        </p>
      </div>
      {data === null ? (
        <EmptyValue />
      ) : (
        <>
          <p className="text-sm font-semibold tracking-tight truncate">
            {data.taskType}
          </p>
          <p className="text-base font-semibold tabular-nums truncate">
            {Math.round(data.completionPct)}%
          </p>
          <p className="text-xs text-muted-foreground truncate">
            {data.doneCount} of {data.totalCount} done
          </p>
        </>
      )}
    </article>
  );
}

function EmptyValue() {
  return (
    <p className="text-sm text-muted-foreground italic">
      No data for this period
    </p>
  );
}

function formatIstDate(istDate: string): string {
  const [y, m, d] = istDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  });
}
