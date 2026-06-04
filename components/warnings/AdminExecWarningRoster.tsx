import Link from 'next/link';

import { Icon } from '@/components/ui/icon';

import { HARD_WARNING_FIRE_THRESHOLD } from '@/lib/warnings/metrics';

import { WarningButtons } from './WarningButtons';

// =============================================================================
// HVA-228: AdminExecWarningRoster — table of execs with soft+hard buttons
// =============================================================================
//
// Sits below the TeamTargetArena on /admin/targets. One row per exec:
//   - name + captain
//   - current active soft + hard counts
//   - 5/5 fire-flag badge when hardActive >= threshold
//   - WarningButtons (Soft + Hard, compact variant)
//   - Drill link to /admin/settings/organization/executives/[id] for
//     history + revoke
//
// Server component — receives the enriched rows from the page.
// =============================================================================

export interface AdminExecRosterRow {
  execUserId: string;
  execName: string;
  captainUserId: string | null;
  captainName: string | null;
  cityNames: string[];
  softActive: number;
  hardActive: number;
}

interface Props {
  rows: AdminExecRosterRow[];
}

export function AdminExecWarningRoster({ rows }: Props) {
  if (rows.length === 0) {
    return (
      <section
        aria-label="Performance warnings"
        className="rounded-3xl border bg-card p-6 text-center text-sm text-muted-foreground"
      >
        No active executives to manage.
      </section>
    );
  }

  return (
    <section
      aria-label="Performance warnings"
      className="rounded-3xl border bg-card p-4 sm:p-6 shadow-sm space-y-3"
    >
      <header className="space-y-1">
        <h2 className="text-base sm:text-lg font-semibold tracking-tight inline-flex items-center gap-2">
          <Icon name="gpp_maybe" size="sm" className="text-muted-foreground" />
          Performance warnings
        </h2>
        <p className="text-[12px] text-muted-foreground">
          Issue a soft warning as an initial motivational nudge. Issue a
          hard warning for repeat underperformance —{' '}
          {HARD_WARNING_FIRE_THRESHOLD} active hard warnings flags the exec for termination.
        </p>
      </header>

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="text-left py-2.5 px-3">Executive</th>
              <th className="text-left py-2.5 px-3 hidden sm:table-cell">
                Captain · cities
              </th>
              <th className="text-center py-2.5 px-3">Soft</th>
              <th className="text-center py-2.5 px-3">Hard</th>
              <th className="text-right py-2.5 px-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => {
              const fireFlag = r.hardActive >= HARD_WARNING_FIRE_THRESHOLD;
              return (
                <tr key={r.execUserId} className="hover:bg-muted/30">
                  <td className="py-3 px-3 align-top">
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <Link
                        href={`/admin/settings/organization/executives/${r.execUserId}`}
                        className="text-sm font-medium tracking-tight hover:underline truncate"
                      >
                        {r.execName}
                      </Link>
                      {fireFlag && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-rose-700">
                          <Icon name="gpp_bad" size="xs" />
                          Eligible for termination
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-3 hidden sm:table-cell align-top">
                    <p className="text-[12px] text-muted-foreground truncate">
                      {r.captainName ?? '—'}
                    </p>
                    {r.cityNames.length > 0 && (
                      <p className="text-[10px] text-muted-foreground/80">
                        {r.cityNames.join(', ')}
                      </p>
                    )}
                  </td>
                  <td className="py-3 px-3 text-center align-top">
                    {r.softActive > 0 ? (
                      <span className="inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 rounded-full bg-amber-100 text-amber-800 text-[12px] font-semibold tabular-nums">
                        {r.softActive}
                      </span>
                    ) : (
                      <span className="text-muted-foreground/50 text-[12px]">
                        —
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-3 text-center align-top">
                    {r.hardActive > 0 ? (
                      <span
                        className={`inline-flex items-center justify-center min-w-[36px] h-6 px-2 rounded-full text-[12px] font-semibold tabular-nums ${
                          fireFlag
                            ? 'bg-rose-600 text-white'
                            : 'bg-rose-100 text-rose-800'
                        }`}
                      >
                        {r.hardActive}/{HARD_WARNING_FIRE_THRESHOLD}
                      </span>
                    ) : (
                      <span className="text-muted-foreground/50 text-[12px]">
                        —
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-3 align-top">
                    <div className="flex items-center justify-end">
                      <WarningButtons
                        execUserId={r.execUserId}
                        execName={r.execName}
                        captainName={r.captainName}
                        currentHardCount={r.hardActive}
                        variant="compact"
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
