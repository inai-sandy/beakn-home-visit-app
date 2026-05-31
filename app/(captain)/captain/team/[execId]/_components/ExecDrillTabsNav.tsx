import Link from 'next/link';

import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/utils';

// HVA-83: 7-tab nav for the captain exec drill-down. Server component —
// each trigger is a plain Link that preserves the calendar's URL state.
// No JS needed for tab switching; the page server-renders the active
// tab's content on each click.

export type ExecDrillTab =
  | 'today'
  | 'calendar'
  | 'performance'
  | 'requests'
  | 'collections'
  | 'red-flags'
  | 'audit';

export const EXEC_DRILL_TABS: { value: ExecDrillTab; label: string; icon: string }[] = [
  { value: 'today', label: "Today's Plan", icon: 'today' },
  { value: 'calendar', label: 'Calendar', icon: 'calendar_month' },
  { value: 'performance', label: 'Performance', icon: 'trending_up' },
  { value: 'requests', label: 'Open Requests', icon: 'list_alt' },
  { value: 'collections', label: 'Collections', icon: 'payments' },
  { value: 'red-flags', label: 'Red Flags', icon: 'flag' },
  { value: 'audit', label: 'Audit Trail', icon: 'history' },
];

export function isValidExecDrillTab(value: unknown): value is ExecDrillTab {
  if (typeof value !== 'string') return false;
  return EXEC_DRILL_TABS.some((t) => t.value === value);
}

interface Props {
  execId: string;
  activeTab: ExecDrillTab;
  /** Pass through any other query params (date filter, etc.) so the user
   *  doesn't lose them when switching tabs. */
  preservedQuery: Record<string, string>;
}

export function ExecDrillTabsNav({ execId, activeTab, preservedQuery }: Props) {
  return (
    <nav aria-label="Drill-down sections" className="border-b bg-card">
      {/* Full-width border-b keeps the visual line edge-to-edge, but the
       *  items align with the rest of the page content (max-w-2xl
       *  centered) instead of hugging the left edge on desktop. */}
      <div className="mx-auto max-w-2xl overflow-x-auto">
        <ul className="flex items-center gap-1 px-2 sm:px-4 min-w-max">
          {EXEC_DRILL_TABS.map((tab) => {
            const active = tab.value === activeTab;
            const sp = new URLSearchParams(preservedQuery);
            sp.set('tab', tab.value);
            return (
              <li key={tab.value}>
                <Link
                  href={`/captain/team/${execId}?${sp.toString()}`}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'inline-flex items-center gap-2 px-3 py-3 text-sm whitespace-nowrap border-b-2 transition-colors',
                    active
                      ? 'border-primary text-primary font-semibold'
                      : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30',
                  )}
                >
                  <Icon name={tab.icon} size="xs" />
                  {tab.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
