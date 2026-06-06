// =============================================================================
// HVA-235 (HVA-231 Phase 1.1): support portal navigation
// HVA-245: 4-tab nav v2 — Pending / In-progress / Orders / Activity
// =============================================================================
//
// Tabs in order:
//   Pending      = line items awaiting first dispatch (qty_dispatched = 0)
//   In-progress  = items with at least 1 dispatch, not yet fully done
//   Orders       = every ORDER_CONFIRMED+ visit_request with a state pill
//   Activity     = chronological feed of dispatch lifecycle events
// =============================================================================

export interface SupportNavItem {
  href: string;
  label: string;
  iconName: string;
}

export const SUPPORT_NAV: ReadonlyArray<SupportNavItem> = [
  { href: '/support', label: 'Pending', iconName: 'inventory_2' },
  { href: '/support/in-progress', label: 'In-progress', iconName: 'sync' },
  { href: '/support/orders', label: 'Orders', iconName: 'receipt_long' },
  { href: '/support/activity', label: 'Activity', iconName: 'history' },
];

/**
 * Resolve a `pathname` (from Next.js navigation) to one of the SUPPORT_NAV
 * entries. Used by the sidebar's active-state highlight + the mobile
 * topbar's "current page" label.
 *
 * Match rule: exact match on `/support` (Pending), prefix match on the
 * sub-routes. Returns null on unknown paths so the caller can fall back
 * to a default ("Support portal").
 */
export function activeSupportNav(pathname: string): SupportNavItem | null {
  if (pathname === '/support') return SUPPORT_NAV[0];
  for (const item of SUPPORT_NAV.slice(1)) {
    if (pathname === item.href || pathname.startsWith(`${item.href}/`)) {
      return item;
    }
  }
  return null;
}
