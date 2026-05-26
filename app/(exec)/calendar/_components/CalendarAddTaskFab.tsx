'use client';

import { useState } from 'react';

import { AddTaskSheet } from '@/app/(exec)/today/_components/AddTaskSheet';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';

// =============================================================================
// F3 2026-05-26: floating "+ Add task" button on /calendar
// =============================================================================

interface LinkableRequest {
  id: string;
  customerName: string;
  customerPhone: string;
}

interface LinkableLead {
  id: string;
  name: string;
  phone: string;
}

interface Props {
  /** ISO date (YYYY-MM-DD) the user is currently viewing on /calendar.
   *  Pre-fills the task_date picker so adding a task on the day you
   *  navigated to doesn't require re-picking. */
  anchorDate: string;
  linkableRequests: LinkableRequest[];
  linkableLeads: LinkableLead[];
}

export function CalendarAddTaskFab({
  anchorDate,
  linkableRequests,
  linkableLeads,
}: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        onClick={() => setOpen(true)}
        size="lg"
        className="fixed bottom-20 right-4 h-14 w-14 rounded-full shadow-lg z-30 lg:bottom-6"
        aria-label="Add task"
      >
        <Icon name="add" size="md" />
      </Button>
      {open && (
        <AddTaskSheet
          linkableRequests={linkableRequests}
          linkableLeads={linkableLeads}
          initialTaskDate={anchorDate}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
