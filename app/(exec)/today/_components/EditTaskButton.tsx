'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';

import {
  AddTaskSheet,
  type LinkableLead,
  type LinkableRequest,
  type TaskToEdit,
} from './AddTaskSheet';

// =============================================================================
// HVA-159: pencil-button wrapper for a task row — opens AddTaskSheet in
// edit mode, prefilled with the task's current values.
// =============================================================================

interface Props {
  task: TaskToEdit;
  linkableRequests: LinkableRequest[];
  linkableLeads: LinkableLead[];
}

export function EditTaskButton({ task, linkableRequests, linkableLeads }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => setOpen(true)}
        aria-label="Edit task"
        className="h-9 w-9 shrink-0"
      >
        <Icon name="edit" size="sm" />
      </Button>
      {open && (
        <AddTaskSheet
          linkableRequests={linkableRequests}
          linkableLeads={linkableLeads}
          taskToEdit={task}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
