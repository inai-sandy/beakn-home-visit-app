import { Icon } from '@/components/ui/icon';

import type { DateFilter } from '@/lib/captain/dashboard-queries';
import { getIstDateString } from '@/lib/today/time';

// =============================================================================
// HVA-169 — exec dashboard header
// =============================================================================
//
// Server-rendered. Mirrors the captain DashboardHeader title + label
// pattern but doesn't carry the calendar picker itself — the picker
// renders separately, above the Performance card, so the visual
// hierarchy keeps the calendar near the metrics it scopes.
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
        <p className="text-sm text-muted-foreground mt-1">Your day at a glance.</p>
      </div>
      <span className="inline-flex items-center px-3 py-1 rounded-full bg-muted text-sm text-muted-foreground">
        <Icon name="calendar_today" size="xs" className="mr-1.5" />
        {label}
      </span>
    </header>
  );
}
