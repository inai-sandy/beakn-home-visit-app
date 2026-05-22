'use client';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';

import { getIstDateString } from '@/lib/today/time';

import { TaskItem } from '../../today/_components/TaskItem';

import type { ExecDashboardTaskRow } from '@/lib/exec/dashboard-queries';

// =============================================================================
// HVA-169 D4 — Today's Tasks accordion
// =============================================================================
//
// Three sections: Pending (open by default), Postponed (collapsed),
// Completed (collapsed). Counts shown on each trigger.
//
// Pending section includes rolled-over tasks; each gets an inline pill
// "Rolled over from {YYYY-MM-DD}" above the underlying TaskItem so the
// exec sees why this isn't on today's plan.
//
// Postponed + Completed pass `readOnly={true}` — the dashboard is
// inspect-only for non-pending; the operational mutation surface for
// those buckets stays at /today.
//
// Reuses TaskItem verbatim per the DO NOT list — no behaviour changes.
// =============================================================================

interface Props {
  pending: ExecDashboardTaskRow[];
  postponed: ExecDashboardTaskRow[];
  completed: ExecDashboardTaskRow[];
  outcomeOptionsByType: Record<string, Array<{ id: string; code: string; name: string }>>;
  postponeReasons: Array<{ id: string; code: string; name: string }>;
  linkableRequests: Array<{ id: string; customerName: string; customerPhone: string }>;
  linkableLeads: Array<{ id: string; name: string; phone: string }>;
}

function formatRolledOverDate(istDate: string): string {
  const [y, m, d] = istDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  });
}

// HVA-171: a postponed task is "overdue" when its target date is strictly
// before today IST. Rows postponed TO today render the normal section but
// without the overdue badge (still actionable on their own terms).
function isOverduePostponed(postponedToDate: string | null): boolean {
  if (postponedToDate === null) return false;
  return postponedToDate < getIstDateString();
}

export function TasksAccordion({
  pending,
  postponed,
  completed,
  outcomeOptionsByType,
  postponeReasons,
  linkableRequests,
  linkableLeads,
}: Props) {
  return (
    <section
      aria-label="Today's tasks"
      className="rounded-3xl border bg-card shadow-sm px-4 sm:px-5"
    >
      <Accordion type="multiple" defaultValue={['pending']} className="w-full">
        <AccordionItem value="pending">
          <AccordionTrigger>
            <span className="inline-flex items-center gap-2">
              Pending
              <span className="text-muted-foreground font-normal">({pending.length})</span>
            </span>
          </AccordionTrigger>
          <AccordionContent>
            {pending.length === 0 ? (
              <EmptyRow text="Nothing pending — you're on top of today." />
            ) : (
              <ul className="space-y-3">
                {pending.map((t) => (
                  <li key={t.id} className="space-y-1.5">
                    {t.rolledOverAt && (
                      <Badge
                        variant="outline"
                        className="text-[10px] gap-1 border-yellow-500/50"
                      >
                        <Icon name="history" size="xs" aria-hidden />
                        Rolled over from {formatRolledOverDate(t.taskDate)}
                      </Badge>
                    )}
                    <TaskItem
                      task={t}
                      outcomeOptionsForType={outcomeOptionsByType[t.taskType] ?? []}
                      postponeReasons={postponeReasons}
                      readOnly={false}
                      linkableRequests={linkableRequests}
                      linkableLeads={linkableLeads}
                    />
                  </li>
                ))}
              </ul>
            )}
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="postponed">
          <AccordionTrigger>
            <span className="inline-flex items-center gap-2">
              Postponed
              <span className="text-muted-foreground font-normal">({postponed.length})</span>
            </span>
          </AccordionTrigger>
          <AccordionContent>
            {postponed.length === 0 ? (
              <EmptyRow text="Nothing postponed. Nice." />
            ) : (
              <ul className="space-y-3">
                {postponed.map((t) => (
                  <li key={t.id} className="space-y-1.5">
                    {isOverduePostponed(t.postponedToDate) && (
                      <Badge
                        variant="outline"
                        className="text-[10px] gap-1 border-destructive/50 text-destructive"
                      >
                        <Icon name="event_busy" size="xs" aria-hidden />
                        Overdue · postponed to{' '}
                        {formatRolledOverDate(t.postponedToDate!)}
                      </Badge>
                    )}
                    <TaskItem
                      task={t}
                      outcomeOptionsForType={outcomeOptionsByType[t.taskType] ?? []}
                      postponeReasons={postponeReasons}
                      readOnly
                    />
                  </li>
                ))}
              </ul>
            )}
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="completed">
          <AccordionTrigger>
            <span className="inline-flex items-center gap-2">
              Completed
              <span className="text-muted-foreground font-normal">({completed.length})</span>
            </span>
          </AccordionTrigger>
          <AccordionContent>
            {completed.length === 0 ? (
              <EmptyRow text="No completed tasks yet." />
            ) : (
              <ul className="space-y-3">
                {completed.map((t) => (
                  <li key={t.id}>
                    <TaskItem
                      task={t}
                      outcomeOptionsForType={outcomeOptionsByType[t.taskType] ?? []}
                      postponeReasons={postponeReasons}
                      readOnly
                    />
                  </li>
                ))}
              </ul>
            )}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </section>
  );
}

function EmptyRow({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed bg-background/50 p-4 text-sm text-muted-foreground">
      {text}
    </div>
  );
}
