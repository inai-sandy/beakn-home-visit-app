// =============================================================================
// HVA-152: captain navigation config (shared between desktop sidebar + mobile drawer)
// =============================================================================
//
// Pure-data export. Previously inline in app/(captain)/sidebar.tsx.
// Moved out so the mobile drawer (CaptainSidebarSheet) can import the
// same list — single source of truth keeps the two surfaces in sync
// when a future nav item is added.
//
// The sidebar.tsx render output is byte-identical to pre-extraction
// (verified by the HVA-152 desktop snapshot test).
// =============================================================================

export interface CaptainNavItem {
  href: string;
  label: string;
  /** Material Symbols Rounded glyph name passed to `<Icon name=…>`. */
  icon: string;
}

export const CAPTAIN_NAV_ITEMS: CaptainNavItem[] = [
  { href: '/captain/dashboard', label: 'Dashboard', icon: 'dashboard' },
  // HVA-127: surfaces every request in the captain's cities across all
  // statuses. Placed second since this is the captain's primary workflow.
  { href: '/captain/requests', label: 'Requests', icon: 'list_alt' },
  { href: '/captain/team', label: 'My Team', icon: 'groups' },
  // 2026-06-05: team-wide task list with sort/filter/pagination.
  { href: '/captain/tasks', label: 'Tasks', icon: 'task' },
  // 2026-05-26: team-wide visit + task calendar so the captain can see
  // coverage at a glance instead of drilling into each exec.
  { href: '/captain/calendar', label: 'Team Calendar', icon: 'calendar_month' },
  // HVA-73 PR 2: every contact captured by the captain's team (including
  // auto-created ones from request assignment). Read-only for captain
  // in this ticket; edit lands in PR 3.
  { href: '/captain/contacts', label: 'Contacts', icon: 'contacts' },
  { href: '/captain/approvals', label: 'Pending Approvals', icon: 'task_alt' },
  // HVA-199: assist requests from the captain's team execs.
  { href: '/captain/assist', label: 'Assist Requests', icon: 'support_agent' },
  { href: '/captain/collections', label: 'Finance', icon: 'payments' },
  // HVA-201: global leaderboard across all execs.
  { href: '/captain/leaderboard', label: 'Leaderboard', icon: 'leaderboard' },
  // Sandeep 2026-06-03: monthly target arena moved off dashboard.
  { href: '/captain/targets', label: 'Team Targets', icon: 'flag' },
  { href: '/captain/reports', label: 'Reports', icon: 'monitoring' },
  { href: '/captain/resources', label: 'Resources', icon: 'folder' },
  { href: '/captain/announcements', label: 'Announcements', icon: 'campaign' },
  { href: '/captain/profile', label: 'Profile', icon: 'person' },
];

/**
 * Returns true iff a nav item should highlight as "active" for the given
 * pathname. /captain/dashboard is exact-match only; every other item
 * also highlights for descendant routes (e.g. /captain/requests/unassigned
 * keeps "Requests" active).
 */
export function isCaptainNavItemActive(
  itemHref: string,
  pathname: string,
): boolean {
  if (pathname === itemHref) return true;
  if (itemHref === '/captain/dashboard') return false;
  return pathname.startsWith(`${itemHref}/`);
}

/**
 * Resolves the page title for the mobile topbar from the current pathname.
 * Falls back to "Captain" when nothing matches (e.g. nested routes the
 * nav config doesn't know about).
 */
export function resolveCaptainPageTitle(pathname: string): string {
  // Longest-prefix match so /captain/requests/unassigned resolves to
  // "Requests" rather than to the catch-all fallback.
  let bestMatch: CaptainNavItem | null = null;
  for (const item of CAPTAIN_NAV_ITEMS) {
    if (pathname === item.href || pathname.startsWith(`${item.href}/`)) {
      if (bestMatch === null || item.href.length > bestMatch.href.length) {
        bestMatch = item;
      }
    }
  }
  return bestMatch?.label ?? 'Captain';
}
