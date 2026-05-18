import { Icon } from '@/components/ui/icon';

import type { TeamExecStatus } from '@/lib/captain/dashboard-queries';

import { ExecStatusRow } from './ExecStatusRow';

// =============================================================================
// HVA-80: Exec status list (right column on desktop, second card on mobile)
// =============================================================================

interface Props {
  execs: TeamExecStatus[];
}

export function ExecStatusList({ execs }: Props) {
  return (
    <section
      aria-label="Team status"
      className="rounded-3xl border bg-card shadow-sm overflow-hidden"
    >
      <header className="px-5 py-4 border-b">
        <h2 className="text-base font-semibold tracking-tight">Team</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          {execs.length === 0
            ? 'No team members yet.'
            : `${execs.length} ${execs.length === 1 ? 'exec' : 'execs'} · sorted by today's activity`}
        </p>
      </header>

      {execs.length === 0 ? (
        <div className="px-5 py-10 text-center space-y-3">
          <Icon name="group_off" size="lg" className="text-muted-foreground/70 mx-auto" />
          <p className="text-sm text-muted-foreground">
            No team members assigned. Ask admin to add sales executives.
          </p>
        </div>
      ) : (
        <ul className="divide-y" aria-label="Sales executives">
          {execs.map((exec) => (
            <ExecStatusRow key={exec.userId} exec={exec} />
          ))}
        </ul>
      )}
    </section>
  );
}
