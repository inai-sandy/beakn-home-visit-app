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
  // HVA-342 — exec dispatch requests. Replaces the assist.* family.
  'dispatch_request.created': 'inventory_2',
  'dispatch_request.approved': 'local_shipping',
  'dispatch_request.held': 'pause_circle',
  'dispatch_request.rejected': 'cancel',
  'dispatch_request.item_cancelled': 'remove_shopping_cart',
};

export function getEventTypeIcon(eventType: string): string {
  return ICON_BY_EVENT[eventType] ?? 'notifications';
}
