// HVA-52: eventType → Material Symbols icon mapping for the notification
// drawer. Add a key here when a new event type lands a composer in
// lib/notifications/compose/.

const ICON_BY_EVENT: Record<string, string> = {
  'request.assigned': 'assignment',
  'request.reassigned': 'swap_horiz',
  'request.rolled_back': 'undo',
  'request.approved': 'check_circle',
  'request.rejected': 'cancel',
  'request.completed': 'task_alt',
  'request.escalated': 'priority_high',
  // HVA-199 — assist domain events.
  'assist.created': 'support_agent',
  'assist.approved': 'check_circle',
  'assist.processing': 'sync',
  'assist.dispatched': 'local_shipping',
  'assist.rejected': 'cancel',
};

export function getEventTypeIcon(eventType: string): string {
  return ICON_BY_EVENT[eventType] ?? 'notifications';
}
