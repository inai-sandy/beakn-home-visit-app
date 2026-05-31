import { LeadAvatar } from '@/components/leads/LeadAvatar';
import { BackButton } from '@/components/ui/back-button';
import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';

import { MarkUnavailableToggle } from './MarkUnavailableToggle';

// =============================================================================
// HVA-167: sticky header for /captain/team/[execId]
// =============================================================================
//
// Mirrors the request-detail sticky pattern (HVA-66): backdrop blur,
// border-bottom, 14-unit tall content row. Below the sticky band sits
// the static identity block — avatar + name + city badges + Mark
// Unavailable + 4-number quick-stats row.
// =============================================================================

export interface QuickStats {
  visitsToday: number;
  collectionsTodayRupees: number;
  activeRequestCount: number;
  overdueTaskCount: number;
}

interface Props {
  exec: {
    userId: string;
    fullName: string;
    phone: string;
    isUnavailable: boolean;
    hasRedFlag: boolean;
    /** HVA-85: drives the rebalance dialog's team-pool query. */
    captainUserId: string;
  };
  cities: ReadonlyArray<{ id: string; name: string }>;
  quickStats: QuickStats;
}

function formatRupeesCompact(rupees: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(rupees);
}

export function ExecDrillDownHeader({ exec, cities, quickStats }: Props) {
  return (
    <>
      <header className="sticky top-0 z-20 bg-background/90 backdrop-blur border-b">
        <div className="mx-auto max-w-2xl px-4 sm:px-6 h-14 flex items-center gap-3">
          <BackButton
            fallback="/captain/team"
            ariaLabel="Back to My Team"
            size="icon"
            className="h-11 w-11 shrink-0"
          />
          <p className="text-base font-semibold tracking-tight truncate flex-1">
            {exec.fullName}
          </p>
          {exec.isUnavailable && (
            <Badge variant="outline" className="text-[10px] shrink-0">
              Unavailable
            </Badge>
          )}
        </div>
      </header>

      <section
        aria-label="Exec identity"
        className="mx-auto max-w-2xl px-4 sm:px-6 pt-4 pb-3 space-y-3"
      >
        <div className="flex items-center gap-3">
          <LeadAvatar name={exec.fullName} aria-hidden />
          <div className="min-w-0 flex-1">
            {/* Row 1: name + red-flag badge */}
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight truncate min-w-0">
                {exec.fullName}
              </h1>
              {exec.hasRedFlag && (
                <Badge variant="destructive" className="text-[10px] shrink-0">
                  ⚑ {quickStats.overdueTaskCount}
                </Badge>
              )}
            </div>
            {/* Row 2: cities + phone + call — single line, scroll on overflow */}
            <div className="flex items-center gap-2 text-xs text-muted-foreground overflow-x-auto min-w-0">
              {cities.map((c) => (
                <Badge
                  key={c.id}
                  variant="secondary"
                  className="text-[10px] uppercase tracking-wide shrink-0"
                >
                  {c.name}
                </Badge>
              ))}
              {cities.length > 0 && <span className="shrink-0">·</span>}
              <a
                href={`tel:${exec.phone}`}
                aria-label={`Call ${exec.fullName}`}
                className="inline-flex items-center gap-1 font-mono shrink-0 hover:text-foreground"
              >
                <Icon name="phone" size="xs" />
                {exec.phone}
              </a>
            </div>
          </div>
          <MarkUnavailableToggle
            execUserId={exec.userId}
            execName={exec.fullName}
            captainUserId={exec.captainUserId}
            initial={exec.isUnavailable}
          />
        </div>

        <dl className="grid grid-cols-4 gap-2">
          <Stat label="Visits" value={String(quickStats.visitsToday)} />
          <Stat
            label="Collected"
            value={formatRupeesCompact(quickStats.collectionsTodayRupees)}
          />
          <Stat
            label="Active"
            value={String(quickStats.activeRequestCount)}
          />
          <Stat
            label="Overdue"
            value={String(quickStats.overdueTaskCount)}
            destructive={quickStats.overdueTaskCount > 0}
          />
        </dl>
      </section>
    </>
  );
}

function Stat({
  label,
  value,
  destructive = false,
}: {
  label: string;
  value: string;
  destructive?: boolean;
}) {
  return (
    <div className="rounded-xl border bg-card px-2 py-1.5 min-w-0">
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground truncate">
        {label}
      </dt>
      <dd
        className={
          destructive
            ? 'text-sm font-semibold tracking-tight text-destructive tabular-nums truncate'
            : 'text-sm font-semibold tracking-tight tabular-nums truncate'
        }
      >
        {value}
      </dd>
    </div>
  );
}
