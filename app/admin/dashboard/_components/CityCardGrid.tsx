import Link from 'next/link';

import { LeadAvatar } from '@/components/leads/LeadAvatar';
import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';

import type { CityCard } from '@/lib/admin/dashboard-queries';
import { adminFormatRupees } from './GlobalAggregatesColumn';

// HVA-88: middle column — 9 city cards (3-col grid).

interface Props {
  cards: CityCard[];
}

export function CityCardGrid({ cards }: Props) {
  if (cards.length === 0) {
    return (
      <section
        aria-label="Cities"
        className="rounded-3xl border border-dashed bg-card/40 p-10 text-center space-y-3"
      >
        <Icon name="location_city" size="md" className="text-muted-foreground mx-auto" />
        <p className="text-sm text-muted-foreground">
          No active cities. Add cities in{' '}
          <Link
            className="underline-offset-2 hover:underline"
            href="/admin/settings/organization/cities"
          >
            Settings → Cities
          </Link>{' '}
          to populate the dashboard.
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Cities" className="space-y-3">
      <h2 className="text-sm font-semibold tracking-tight uppercase text-muted-foreground">
        Cities
      </h2>
      <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {cards.map((c) => (
          <li key={c.cityId}>
            {/* HVA-88 Phase 1: drill into the captain Requests list filtered
                by this city. super_admin can access /captain/* per existing
                escape hatch in app/(captain)/layout.tsx. */}
            <Link
              href={`/captain/requests?city=${encodeURIComponent(c.cityId)}`}
              className="block rounded-3xl border bg-card p-4 shadow-sm space-y-3 hover:bg-accent/40 transition-colors"
            >
              <header className="flex items-start gap-3">
                <LeadAvatar
                  name={c.captain?.fullName ?? c.cityName}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="text-base font-semibold tracking-tight truncate">
                    {c.cityName}
                    {c.isOther && (
                      <Badge
                        variant="outline"
                        className="ml-2 text-[9px] uppercase tracking-wide border-amber-500/60 text-amber-700"
                      >
                        Other
                      </Badge>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {c.captain ? c.captain.fullName : 'No captain assigned'}
                  </p>
                </div>
              </header>
              <dl className="grid grid-cols-3 gap-2 text-center">
                <div className="min-w-0">
                  <dt className="text-[10px] uppercase tracking-wide text-muted-foreground truncate">
                    Visits
                  </dt>
                  <dd className="text-sm font-semibold tabular-nums truncate">
                    {c.visitsToday}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-[10px] uppercase tracking-wide text-muted-foreground truncate">
                    Collected
                  </dt>
                  <dd className="text-sm font-semibold tabular-nums truncate">
                    {adminFormatRupees(c.collectionsTodayPaise)}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-[10px] uppercase tracking-wide text-muted-foreground truncate">
                    Orders
                  </dt>
                  <dd className="text-sm font-semibold tabular-nums truncate">
                    {c.ordersToday}
                  </dd>
                </div>
              </dl>
              <footer className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>{c.execCount} exec{c.execCount === 1 ? '' : 's'}</span>
                {c.nonSubmitterCount > 0 && (
                  <span className="text-destructive font-medium">
                    {c.nonSubmitterCount} didn't submit plan
                  </span>
                )}
              </footer>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
