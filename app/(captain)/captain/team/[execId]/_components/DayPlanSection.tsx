import { format, parseISO } from 'date-fns';

import { TaskItem } from '@/app/(exec)/today/_components/TaskItem';

import type { ExecDayPlanData, ExecDayPlanDay } from '@/lib/captain/exec-drill-queries';

// =============================================================================
// HVA-167: Day Plan section (read-only — TaskItem in readOnly mode)
// =============================================================================
//
// Single mode: title + one day. Range mode: title + a stack of day
// groups, each with its tasks. TaskItem's readOnly={true} hides every
// mutation control, leaving an inspect-only row.
// =============================================================================

interface Props {
  data: ExecDayPlanData;
}

function formatPlanDate(istDate: string): string {
  // istDate is YYYY-MM-DD. parseISO + format renders "Tuesday, 20 May 2026".
  const d = parseISO(`${istDate}T00:00:00`);
  return format(d, 'EEEE, d MMM yyyy');
}

export function DayPlanSection({ data }: Props) {
  const heading = data.mode === 'single' ? 'Day Plan' : 'Day Plans';
  return (
    <section
      aria-label="Day plan"
      className="rounded-2xl border bg-card p-4 space-y-3"
    >
      <header className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 className="text-base font-semibold tracking-tight">{heading}</h2>
        <p className="text-xs text-muted-foreground">
          {data.doneTotal}/{data.taskTotal} tasks done
        </p>
      </header>

      {data.days.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No plan submitted in this window.
        </p>
      ) : (
        <ul className="space-y-4" aria-label="Day plan history">
          {data.days.map((day) => (
            <li key={day.planDate} className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                {formatPlanDate(day.planDate)}
              </p>
              <DayBlock day={day} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DayBlock({ day }: { day: ExecDayPlanDay }) {
  if (day.planId === null) {
    return (
      <p className="text-xs text-muted-foreground italic pl-2">
        No plan submitted.
      </p>
    );
  }
  if (day.tasks.length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic pl-2">
        Plan submitted, no tasks recorded.
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {day.tasks.map((t) => (
        <li key={t.id}>
          <TaskItem
            task={{
              id: t.id,
              taskType: t.taskType,
              description: t.description,
              estimatedTime: t.estimatedTime,
              status: t.status,
              taskDate: t.taskDate,
              linkRequestId: t.linkRequestId,
              linkLeadId: t.linkLeadId,
              outcomeOptionId: t.outcomeOptionId,
              outcomeOptionName: t.outcomeOptionName,
              outcomeNotes: t.outcomeNotes,
              postponedToDate: t.postponedToDate,
              customerInformed: t.customerInformed,
              createdAt: t.createdAt,
            }}
            outcomeOptionsForType={[]}
            postponeReasons={[]}
            readOnly={true}
          />
        </li>
      ))}
    </ul>
  );
}
