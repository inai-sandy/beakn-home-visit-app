import { formatDistanceToNow } from 'date-fns';
import Link from 'next/link';

import { Icon } from '@/components/ui/icon';

import type {
  AdminAlert,
  AdminAlertKind,
} from '@/lib/admin/dashboard-queries';
import { cn } from '@/lib/utils';

// =============================================================================
// HVA-117 redesign: alerts feed
// =============================================================================
//
// Vertical timeline of active alerts (other-city queue items, admin help
// pending replies, aging approvals). Each row has a tone-coloured icon
// tile + title + relative time. Empty state is muted but reassuring.
// =============================================================================

interface Props {
  alerts: AdminAlert[];
}

const KIND_META: Record<
  AdminAlertKind,
  {
    icon: string;
    iconTone: string;
    label: string;
  }
> = {
  other_city: {
    icon: 'location_off',
    iconTone: 'text-amber-600 dark:text-amber-300 bg-amber-500/10',
    label: 'Other city',
  },
  admin_help: {
    icon: 'help',
    iconTone: 'text-sky-600 dark:text-sky-300 bg-sky-500/10',
    label: 'Admin help',
  },
  aging_approval: {
    icon: 'schedule',
    iconTone: 'text-rose-600 dark:text-rose-300 bg-rose-500/10',
    label: 'Aging approval',
  },
};

export function AdminAlertsFeed({ alerts }: Props) {
  return (
    <section
      aria-label="Alerts"
      className="rounded-3xl border bg-card p-5 sm:p-6 shadow-sm"
    >
      <header className="flex items-center justify-between gap-2 mb-4">
        <h2 className="text-base sm:text-lg font-semibold tracking-tight">
          Alerts
        </h2>
        {alerts.length > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 text-rose-700 dark:text-rose-300 px-2 py-0.5 text-[11px] font-semibold tabular-nums ring-1 ring-rose-500/20">
            {alerts.length}
          </span>
        )}
      </header>
      {alerts.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-6 text-center">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
            <Icon name="task_alt" size="sm" />
          </span>
          <p className="text-sm text-muted-foreground">
            All admin queues are clear.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {alerts.map((a) => {
            const meta = KIND_META[a.kind];
            return (
              <li key={`${a.kind}-${a.id}`}>
                <Link
                  href={a.href}
                  className={cn(
                    'group flex items-start gap-3 rounded-2xl border bg-background p-3 transition-colors',
                    'hover:bg-accent/40 hover:border-foreground/20',
                  )}
                >
                  <span
                    className={cn(
                      'inline-flex h-9 w-9 items-center justify-center rounded-xl shrink-0',
                      meta.iconTone,
                    )}
                    aria-hidden
                  >
                    <Icon name={meta.icon} size="sm" />
                  </span>
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground font-semibold">
                      {meta.label}
                    </p>
                    <p className="text-sm font-medium truncate">{a.title}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {formatDistanceToNow(a.at, { addSuffix: true })}
                    </p>
                  </div>
                  <Icon
                    name="chevron_right"
                    size="sm"
                    className="text-muted-foreground/40 group-hover:text-foreground/70 shrink-0 mt-1"
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
