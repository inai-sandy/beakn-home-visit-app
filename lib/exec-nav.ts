// =============================================================================
// HVA-115: exec shell navigation — pure config + active-path helpers
// =============================================================================
//
// Mirror of lib/admin-nav.ts (HVA-86), but simpler: exec has only 3
// destinations (Today / Requests / Profile), no groups, no placeholder
// items. The same shape drives:
//   * mobile bottom nav (full-width 3 slots)
//   * desktop sidebar (3 stacked items)
//   * topbar page-title resolution
//
// Lives in lib/ (not under app/(exec)/) so vitest under the HVA-101 harness
// can import without the layout's React tree.
// =============================================================================

export interface ExecNavItem {
  /** Display label — bottom nav + sidebar share the string. */
  label: string;
  /** Material Symbols Rounded glyph name (matches `<Icon name=...>`). */
  icon: string;
  /** Target href. Every exec nav item is a real route — no placeholders. */
  href: string;
}

export const EXEC_NAV: ExecNavItem[] = [
  { label: 'Today', icon: 'today', href: '/today' },
  { label: 'Requests', icon: 'list_alt', href: '/requests' },
  { label: 'Profile', icon: 'person', href: '/profile' },
];

// =============================================================================
// Active-state detection
// =============================================================================
//
// Rules:
//   1. Exact match on the item's href, OR
//   2. Pathname is nested under the item's href (prefix + '/'). Detail
//      pages like /requests/[id] don't get the exec shell, but if a future
//      sub-route is added under /requests/, the "Requests" tab should
//      stay highlighted.
//
// /today does not host child routes today; the same prefix rule still
// applies for symmetry with the admin shell.
// =============================================================================

export function isExecNavItemActive(
  item: ExecNavItem,
  currentPath: string,
): boolean {
  return currentPath === item.href || currentPath.startsWith(`${item.href}/`);
}

// =============================================================================
// Page-title resolution for the top bar
// =============================================================================
//
// The exec topbar reads the page title from a pathname lookup. Pages that
// aren't represented in EXEC_NAV (none today, but defensive for future
// nested routes that the shell still wraps) fall back to the last path
// segment, title-cased.
// =============================================================================

export function resolveExecPageTitle(currentPath: string): string {
  for (const item of EXEC_NAV) {
    if (isExecNavItemActive(item, currentPath)) return item.label;
  }
  const segments = currentPath.split('/').filter(Boolean);
  const last = segments[segments.length - 1] ?? 'today';
  return last
    .replace(/[-_]/gu, ' ')
    .replace(/\b\w/gu, (m) => m.toUpperCase());
}
