import { Icon } from '@/components/ui/icon';

import type { DateFilter } from '@/lib/captain/dashboard-queries';
import { getIstDateString } from '@/lib/today/time';

import { DateRangePicker } from './DateRangePicker';

// =============================================================================
// HVA-80 extension: dashboard header with date filter picker
// =============================================================================
//
// Server-rendered title + view label + the calendar icon button (the
// button itself is the trigger inside the client DateRangePicker).
//
// View label rules:
//   - today       → "Today"
//   - yesterday   → "Yesterday"
//   - single date → "On 18 May 2026"
//   - 7-day range → "Last 7 days"  (when to === today)
//   - other range → "12 May – 18 May 2026"
// =============================================================================

function formatDate(istDate: string): string {
  const [y, m, d] = istDate.split('-').map(Number);
  // Anchor to UTC so the date below doesn't shift with the server's TZ.
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
    // Yesterday check by subtracting 1 day from istToday lexically.
    const [y, m, d] = istToday.split('-').map(Number);
    const yest = new Date(Date.UTC(y, m - 1, d - 1));
    const yestStr = `${yest.getUTCFullYear()}-${String(yest.getUTCMonth() + 1).padStart(2, '0')}-${String(yest.getUTCDate()).padStart(2, '0')}`;
    if (filter.date === yestStr) return 'Yesterday';
    return `On ${formatDate(filter.date)}`;
  }
  // Range mode
  if (filter.to === istToday) {
    // "Last N days" formatting when window ends at today.
    const [y, m, d] = filter.to.split('-').map(Number);
    const [fy, fm, fd] = filter.from.split('-').map(Number);
    const days =
      Math.round(
        (Date.UTC(y, m - 1, d) - Date.UTC(fy, fm - 1, fd)) /
          (1000 * 60 * 60 * 24),
      ) + 1;
    return `Last ${days} days`;
  }
  return `${formatDate(filter.from)} – ${formatDate(filter.to)}`;
}

export function DashboardHeader({
  filter,
  pathname = '/captain/dashboard',
}: {
  filter: DateFilter;
  /** Where the date picker URL state should write to. Defaults to
   *  the captain dashboard; admin captain-portal view passes
   *  `/admin/portal/[captainId]/dashboard`. */
  pathname?: string;
}) {
  const label = viewLabel(filter);
  return (
    <header className="flex items-start justify-between gap-3 flex-wrap">
      <div className="flex-1 min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">
          <span className="md:hidden">{label}</span>
          <span className="hidden md:inline">
            Today&apos;s team performance and what needs your attention.
          </span>
        </p>
      </div>
      <div className="flex items-center gap-3">
        <span className="hidden md:inline-flex items-center px-3 py-1 rounded-full bg-muted text-sm text-muted-foreground">
          <Icon name="calendar_today" size="xs" className="mr-1.5" />
          {label}
        </span>
        <DateRangePicker filter={filter} pathname={pathname} />
      </div>
    </header>
  );
}
