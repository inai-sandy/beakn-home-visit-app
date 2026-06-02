import Link from 'next/link';

import { LeadAvatar } from '@/components/leads/LeadAvatar';
import { Icon } from '@/components/ui/icon';

import type { CityCard } from '@/lib/admin/dashboard-queries';
import { cn } from '@/lib/utils';

import { formatRupeesShort } from './format';

// =============================================================================
// HVA-117 redesign: premium city cards
// =============================================================================
//
// Replaces the old CityCardGrid that linked to /captain/requests (which
// dropped admin into the captain layout with captain sidebar — Sandeep
// 2026-06-02: "one of the worst things"). New tap target is
// /admin/operations/cities/[cityId] — stays inside the admin shell.
//
// Each card:
//   - status pill (Healthy / At risk / Critical) computed from data
//   - big city name (display-style typography)
//   - captain identity row (avatar + name + exec count)
//   - 4-stat strip (Revenue / Visits / Orders / Status note)
//   - hover lift via shadow + translate
//
// Status rules (kept simple — extendable later):
//   - critical: visits=0 AND captain has execs (no activity yet today)
//   - at_risk:  any execs didn't submit plan today, OR visits<3 with execs
//   - healthy:  otherwise
// =============================================================================

type CityHealth = 'healthy' | 'at_risk' | 'critical';

function classifyCity(c: CityCard): CityHealth {
  if (c.execCount === 0) return 'at_risk';
  if (c.visitsToday === 0) return 'critical';
  if (c.nonSubmitterCount > 0 || c.visitsToday < 3) return 'at_risk';
  return 'healthy';
}

const HEALTH_META: Record<
  CityHealth,
  {
    label: string;
    pillClass: string;
    cardAccent: string;
    icon: string;
  }
> = {
  healthy: {
    label: 'Healthy',
    pillClass:
      'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/20',
    cardAccent: 'before:bg-emerald-500/60',
    icon: 'check_circle',
  },
  at_risk: {
    label: 'At risk',
    pillClass:
      'bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-1 ring-amber-500/20',
    cardAccent: 'before:bg-amber-500/60',
    icon: 'warning',
  },
  critical: {
    label: 'Critical',
    pillClass:
      'bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-1 ring-rose-500/20',
    cardAccent: 'before:bg-rose-500/60',
    icon: 'error',
  },
};

interface Props {
  cards: CityCard[];
}

export function AdminCityGrid({ cards }: Props) {
  if (cards.length === 0) {
    return (
      <section
        aria-label="Cities"
        className="rounded-3xl border border-dashed bg-card/40 p-10 text-center space-y-3"
      >
        <Icon
          name="location_city"
          size="md"
          className="text-muted-foreground mx-auto"
        />
        <p className="text-sm text-muted-foreground">
          No active cities. Add cities in{' '}
          <Link
            className="underline-offset-2 hover:underline text-primary"
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
    <section aria-label="Cities" className="space-y-4">
      <header className="flex items-center justify-between gap-2">
        <h2 className="text-base sm:text-lg font-semibold tracking-tight">
          Cities
        </h2>
        <p className="text-xs text-muted-foreground tabular-nums">
          {cards.length} active
        </p>
      </header>
      <ul className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {cards.map((c) => (
          <CityCardItem key={c.cityId} card={c} />
        ))}
      </ul>
    </section>
  );
}

function CityCardItem({ card }: { card: CityCard }) {
  const health = classifyCity(card);
  const meta = HEALTH_META[health];

  return (
    <li>
      <Link
        href={`/admin/operations/cities/${card.cityId}`}
        className={cn(
          // Card surface
          'relative block rounded-3xl border bg-card p-5 transition-all',
          'hover:-translate-y-0.5 hover:shadow-lg hover:border-foreground/20',
          // Left accent stripe — coloured by health status, anchored via :before
          'before:absolute before:left-0 before:top-6 before:bottom-6 before:w-1 before:rounded-r-full',
          meta.cardAccent,
          'overflow-hidden',
        )}
      >
        {/* Header: status pill */}
        <header className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0 space-y-1">
            <p className="text-lg sm:text-xl font-semibold tracking-tight truncate">
              {card.cityName}
            </p>
            {card.isOther && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-300 px-2 py-0.5 text-[10px] uppercase tracking-wide ring-1 ring-amber-500/20">
                <Icon name="all_inclusive" size="xs" />
                Catch-all
              </span>
            )}
          </div>
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold shrink-0',
              meta.pillClass,
            )}
            aria-label={`Status: ${meta.label}`}
          >
            <Icon name={meta.icon} size="xs" />
            {meta.label}
          </span>
        </header>

        {/* Captain identity */}
        <div className="flex items-center gap-2.5 mb-4 min-w-0">
          <LeadAvatar
            name={card.captain?.fullName ?? card.cityName}
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">
              {card.captain?.fullName ?? 'No captain assigned'}
            </p>
            <p className="text-[11px] text-muted-foreground tabular-nums">
              {card.execCount} exec{card.execCount === 1 ? '' : 's'}
              {card.nonSubmitterCount > 0 && (
                <>
                  <span className="mx-1.5">·</span>
                  <span className="text-amber-700 dark:text-amber-300 font-medium">
                    {card.nonSubmitterCount} not started
                  </span>
                </>
              )}
            </p>
          </div>
        </div>

        {/* Stats row — 3-column grid with vertical separators */}
        <dl className="grid grid-cols-3 divide-x divide-border/60 rounded-2xl bg-muted/40 py-2.5">
          <Stat
            label="Revenue"
            value={formatRupeesShort(card.collectionsTodayPaise)}
          />
          <Stat label="Visits" value={String(card.visitsToday)} />
          <Stat label="Orders" value={String(card.ordersToday)} />
        </dl>
      </Link>
    </li>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center px-2 min-w-0">
      <dt className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </dt>
      <dd className="text-base font-bold tabular-nums tracking-tight truncate max-w-full">
        {value}
      </dd>
    </div>
  );
}
