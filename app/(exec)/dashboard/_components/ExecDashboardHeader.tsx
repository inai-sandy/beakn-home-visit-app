import { DateRangePicker } from '@/app/(captain)/captain/dashboard/_components/DateRangePicker';
import { Icon } from '@/components/ui/icon';

import type { DateFilter } from '@/lib/captain/dashboard-queries';
import { getIstDateString } from '@/lib/today/time';

// =============================================================================
// HVA-169 — exec dashboard header
// =============================================================================
//
// Server-rendered. Mirrors the captain DashboardHeader title + label
// chip + DateRangePicker triplet so the real picker button sits where the
// user actually looks for a calendar control — at the top of the page,
// not below the tasks accordion.
//
// HVA-171 walk-bug fix: the chip was previously rendered on every
// viewport AND the real picker lived in a separate row deep in the page,
// so on mobile Sandeep was tapping the decorative chip (which has a
// calendar icon and looks like a button) and getting no response. Now
// the chip is `hidden md:inline-flex` like the captain header, and the
// real picker renders beside it (or alone on mobile).
// =============================================================================

function formatDate(istDate: string): string {
  const [y, m, d] = istDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function viewLabel(filter: DateFilter): string {
  const istToday = getIstDateString();
  if (filter.mode === 'single') {
    if (filter.date === istToday) return 'Today';
    const [y, m, d] = istToday.split('-').map(Number);
    const yest = new Date(Date.UTC(y, m - 1, d - 1));
    const yestStr = `${yest.getUTCFullYear()}-${String(yest.getUTCMonth() + 1).padStart(2, '0')}-${String(yest.getUTCDate()).padStart(2, '0')}`;
    if (filter.date === yestStr) return 'Yesterday';
    return `On ${formatDate(filter.date)}`;
  }
  if (filter.to === istToday) {
    const [y, m, d] = filter.to.split('-').map(Number);
    const [fy, fm, fd] = filter.from.split('-').map(Number);
    const days =
      Math.round(
        (Date.UTC(y, m - 1, d) - Date.UTC(fy, fm - 1, fd)) / (1000 * 60 * 60 * 24),
      ) + 1;
    return `Last ${days} days`;
  }
  return `${formatDate(filter.from)} – ${formatDate(filter.to)}`;
}

export function ExecDashboardHeader({ filter }: { filter: DateFilter }) {
  const label = viewLabel(filter);
  return (
    <header className="flex items-start justify-between gap-3 flex-wrap">
      <div className="flex-1 min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">
          <span className="md:hidden">{label}</span>
          <span className="hidden md:inline">Your day at a glance.</span>
        </p>
      </div>
      <div className="flex items-center gap-3">
        <span className="hidden md:inline-flex items-center px-3 py-1 rounded-full bg-muted text-sm text-muted-foreground">
          <Icon name="calendar_today" size="xs" className="mr-1.5" />
          {label}
        </span>
        <DateRangePicker filter={filter} pathname="/dashboard" maxDaysBack={365} />
      </div>
    </header>
  );
}
