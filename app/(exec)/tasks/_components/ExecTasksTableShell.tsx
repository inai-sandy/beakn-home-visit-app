'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { TasksTableFilters } from '@/components/tasks/TasksTableFilters';
import { TasksTableView } from '@/components/tasks/TasksTableView';
import type { TasksTableResult, TasksTableRow } from '@/lib/tasks/tasks-table';

import {
  AddTaskSheet,
  type CloneFromTask,
  type LinkableLead,
  type LinkableRequest,
} from '../../today/_components/AddTaskSheet';

import { MoveTaskSheet, type MoveTarget } from './MoveTaskSheet';

// =============================================================================
// HVA-201 follow-up: ExecTasksTableShell — exec /tasks unified table view
// =============================================================================
//
// Replaces the old TasksPageView accordion. Uses the shared
// TasksTableView (the same captain + admin use) plus the exec-specific
// "+" action: opens MoveTaskSheet on pending/postponed rows, opens
// AddTaskSheet in clone mode on completed rows.
//
// Filters live in URL params via TasksTableFilters (debounced search,
// status dropdown, sort direction, from/to date, pagination). The
// captain + exec dropdowns are hidden — exec is always self-scoped.
// =============================================================================

interface Props {
  result: TasksTableResult;
  basePath: string;
  searchString: string;
  status: string;
  sortDir: string;
  q: string;
  from: string;
  to: string;
  linkableRequests: LinkableRequest[];
  linkableLeads: LinkableLead[];
}

function buildCloneSource(task: TasksTableRow): CloneFromTask {
  return {
    taskType: task.taskType,
    description: task.description,
    estimatedTime: task.estimatedTime,
    // HVA-170-FIX1 D14: link fields intentionally dropped — exec re-links
    // in the sheet to avoid stale-assignment validation errors.
  };
}

export function ExecTasksTableShell({
  result,
  basePath,
  searchString,
  status,
  sortDir,
  q,
  from,
  to,
  linkableRequests,
  linkableLeads,
}: Props) {
  const [moveTarget, setMoveTarget] = useState<MoveTarget | null>(null);
  const [cloneSource, setCloneSource] = useState<CloneFromTask | null>(null);

  function openMove(row: TasksTableRow) {
    const targetStatus =
      row.status === 'postponed' ? 'postponed' : 'pending';
    const currentDate =
      targetStatus === 'postponed'
        ? row.postponedToDate ?? row.taskDate
        : row.taskDate;
    setMoveTarget({
      taskId: row.id,
      status: targetStatus,
      currentDate,
      description: row.description,
    });
  }

  function openClone(row: TasksTableRow) {
    setCloneSource(buildCloneSource(row));
  }

  function renderRowActions(row: TasksTableRow) {
    if (row.status === 'pending' || row.status === 'postponed') {
      return (
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-[11px]"
          onClick={() => openMove(row)}
          aria-label={
            row.status === 'postponed' ? 'Reschedule task' : 'Move task'
          }
        >
          <Icon name="edit_calendar" size="xs" />
          {row.status === 'postponed' ? 'Reschedule' : 'Move'}
        </Button>
      );
    }
    if (row.status === 'completed') {
      return (
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-[11px]"
          onClick={() => openClone(row)}
          aria-label="Re-add similar task"
        >
          <Icon name="add" size="xs" />
          Re-add
        </Button>
      );
    }
    return null;
  }

  return (
    <>
      <TasksTableFilters
        status={status}
        sortDir={sortDir}
        q={q}
        from={from}
        to={to}
        captainId="all"
        execId="all"
        captainFacets={[]}
        execFacets={[]}
        showCaptainFacet={false}
        showExecFacet={false}
        basePath={basePath}
      />

      <TasksTableView
        result={result}
        basePath={basePath}
        searchString={searchString}
        showCaptainColumn={false}
        renderRowActions={renderRowActions}
      />

      {moveTarget !== null && (
        <MoveTaskSheet
          target={moveTarget}
          onClose={() => setMoveTarget(null)}
        />
      )}

      {cloneSource !== null && (
        <AddTaskSheet
          linkableRequests={linkableRequests}
          linkableLeads={linkableLeads}
          cloneFromTask={cloneSource}
          onClose={() => setCloneSource(null)}
        />
      )}
    </>
  );
}
