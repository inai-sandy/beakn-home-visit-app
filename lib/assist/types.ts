// HVA-199: shared types for the Assist domain. Importable by both server
// queries + client components without dragging Drizzle imports into the
// browser bundle.

export type AssistType = 'material_request';

export type AssistStatus =
  | 'submitted'
  | 'approved'
  | 'processing'
  | 'dispatched'
  | 'rejected';

export type AssistPriority = 'high' | 'medium' | 'low';

export const ASSIST_TYPE_LABELS: Record<AssistType, string> = {
  material_request: 'Material request',
};

export const ASSIST_STATUS_LABELS: Record<AssistStatus, string> = {
  submitted: 'Submitted',
  approved: 'Approved',
  processing: 'Processing',
  dispatched: 'Dispatched',
  rejected: 'Rejected',
};

export const ASSIST_PRIORITY_LABELS: Record<AssistPriority, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

// Terminal statuses can't transition out. The sidebar badge counts only
// non-terminal rows.
export const TERMINAL_ASSIST_STATUSES: readonly AssistStatus[] = [
  'dispatched',
  'rejected',
];

export function isTerminalAssistStatus(status: AssistStatus): boolean {
  return TERMINAL_ASSIST_STATUSES.includes(status);
}

// Allowed forward transitions per current status. Server action's
// validator + client UI both consult this so they agree on which buttons
// to render. `rejected` is allowed from every pre-terminal status.
export function allowedNextStatuses(from: AssistStatus): AssistStatus[] {
  switch (from) {
    case 'submitted':
      return ['approved', 'rejected'];
    case 'approved':
      return ['processing', 'rejected'];
    case 'processing':
      return ['dispatched', 'rejected'];
    case 'dispatched':
    case 'rejected':
      return [];
  }
}

export function canTransitionTo(
  from: AssistStatus,
  to: AssistStatus,
): boolean {
  return allowedNextStatuses(from).includes(to);
}
