// =============================================================================
// HVA-235 (HVA-231 Phase 1.1): support portal navigation
// =============================================================================
//
// Three placeholder entries for v1. Each route currently renders a
// "Coming in Phase 2" empty state — the routes exist so we can land
// auth + role + shell as one PR. Phase 2 fills in the actual screens.

export interface SupportNavItem {
  href: string;
  label: string;
  iconName: string;
}

export const SUPPORT_NAV: ReadonlyArray<SupportNavItem> = [
  { href: '/support', label: 'Queue', iconName: 'inventory_2' },
  { href: '/support/orders', label: 'Orders', iconName: 'receipt_long' },
  { href: '/support/activity', label: 'Activity', iconName: 'history' },
];

/**
 * Resolve a `pathname` (from Next.js navigation) to one of the SUPPORT_NAV
 * entries. Used by the sidebar's active-state highlight + the mobile
 * topbar's "current page" label.
 *
 * Match rule: exact match on `/support` (the Queue), prefix match on the
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
