import { formatDistanceToNow } from 'date-fns';
import Link from 'next/link';

import { Icon } from '@/components/ui/icon';

import type {
  AdminAlert,
  AdminAlertKind,
} from '@/lib/admin/dashboard-queries';

// HVA-88: right column — combined alerts feed (other-city, admin help,
// aging approvals), time-sorted desc.

interface Props {
  alerts: AdminAlert[];
}

const ICON_BY_KIND: Record<AdminAlertKind, { name: string; color: string }> = {
  other_city: { name: 'location_off', color: 'text-amber-600' },
  admin_help: { name: 'help', color: 'text-blue-600' },
  aging_approval: { name: 'schedule', color: 'text-destructive' },
};

export function AlertsFeed({ alerts }: Props) {
  return (
    <section
      aria-label="Alerts"
      className="rounded-3xl border bg-card p-5 shadow-sm space-y-3"
    >
      <h2 className="text-sm font-semibold tracking-tight uppercase text-muted-foreground">
        Alerts
      </h2>
      {alerts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No active alerts. All admin queues are clear.
        </p>
      ) : (
        <ul className="space-y-2">
          {alerts.map((a) => {
            const meta = ICON_BY_KIND[a.kind];
            return (
              <li
                key={`${a.kind}-${a.id}`}
                className="rounded-2xl border bg-background p-3 hover:bg-accent/40 transition-colors"
              >
                <Link href={a.href} className="flex items-start gap-3">
                  <Icon
                    name={meta.name}
                    size="sm"
                    className={`${meta.color} mt-0.5 shrink-0`}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm truncate">{a.title}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {formatDistanceToNow(a.at, { addSuffix: true })}
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
