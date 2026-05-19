'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import {
  AddTaskSheet,
  type LinkableLead,
  type LinkableRequest,
} from '@/app/(exec)/today/_components/AddTaskSheet';

// =============================================================================
// HVA-73 follow-up: "Create Task in Day Sheet" button on lead detail
// =============================================================================
//
// Opens the existing AddTaskSheet with a preselectedLink so the link
// field is locked to this lead. If the exec hasn't started their day,
// the button is disabled and surfaces a tooltip prompt — we never
// auto-create a plan (bundle DO NOT #3).
// =============================================================================

interface Props {
  lead: { id: string; name: string };
  linkableRequests: LinkableRequest[];
  linkableLeads: LinkableLead[];
  dayPlanReady: boolean;
}

export function CreateTaskFromLeadButton({
  lead,
  linkableRequests,
  linkableLeads,
  dayPlanReady,
}: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="lg"
        disabled={!dayPlanReady}
        onClick={() => setOpen(true)}
        title={
          dayPlanReady
            ? undefined
            : 'Start your day first to add tasks'
        }
        className="w-full"
      >
        <Icon name="add_task" size="sm" />
        Create Task in Day Sheet
      </Button>
      {open && (
        <AddTaskSheet
          linkableRequests={linkableRequests}
          linkableLeads={linkableLeads}
          preselectedLink={{
            type: 'lead',
            id: lead.id,
            displayLabel: lead.name,
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
