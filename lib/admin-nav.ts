// =============================================================================
// HVA-86: admin shell navigation — pure config + active-path helpers
// =============================================================================
//
// Lives in lib/ (not in the admin route folder) so it's importable by
// vitest tests under the HVA-101 harness without the layout's React tree.
//
// The shipped sidebar groups + items are encoded here as a const. Each
// item has either an `href` (real navigation target) or `placeholder:true`
// (rendered as muted, non-clickable text — the REPORTS group uses this).
//
// The "Other-city Queue" item is a query-string variant of /admin/requests.
// We treat it as a distinct item for active-state purposes — selecting it
// requires the pathname to be /admin/requests AND `?city=other`. The
// helper consumes a `currentPath` string and an optional `currentQuery`
// (URLSearchParams or null) to make this match.
// =============================================================================

export interface AdminNavItem {
  /** Sidebar display label. */
  label: string;
  /** Material Symbols Rounded glyph name (matches `<Icon name=...>`). */
  icon: string;
  /** Target href. Omitted for placeholder items. */
  href?: string;
  /** When set, matches only if the URL also carries these query params. */
  query?: Record<string, string>;
  /** Render muted, non-clickable. The REPORTS group is all placeholder. */
  placeholder?: true;
}

export interface AdminNavGroup {
  /** Small-caps group header text in the sidebar. */
  label: string;
  items: AdminNavItem[];
}

export const ADMIN_NAV: AdminNavGroup[] = [
  {
    label: 'Operations',
    items: [
      { label: 'Dashboard', icon: 'dashboard', href: '/admin/dashboard' },
      { label: 'All Requests', icon: 'list_alt', href: '/admin/requests' },
      {
        label: 'Other-city Queue',
        icon: 'priority_high',
        href: '/admin/requests',
        query: { city: 'other' },
      },
      { label: 'Admin Help Inbox', icon: 'help_center', href: '/admin/help' },
    ],
  },
  {
    label: 'People',
    items: [
      { label: 'Captains', icon: 'shield_person', href: '/admin/captains' },
      { label: 'Executives', icon: 'badge', href: '/admin/executives' },
    ],
  },
  {
    label: 'Settings',
    items: [
      {
        label: 'Cities',
        icon: 'location_city',
        href: '/admin/settings/organization/cities',
      },
      {
        label: 'System',
        icon: 'tune',
        href: '/admin/settings/system/customer-support-phone',
      },
    ],
  },
  {
    label: 'Reports',
    items: [
      { label: 'Daily', icon: 'today', placeholder: true },
      { label: 'Weekly', icon: 'date_range', placeholder: true },
      { label: 'Performance trends', icon: 'analytics', placeholder: true },
    ],
  },
];

// =============================================================================
// Active-state detection
// =============================================================================
//
// Rules:
//   1. Placeholder items are never active.
//   2. Items with a `query` constraint match only when ALL of those keys are
//      present in the current URL with the expected value.
//   3. Otherwise: exact pathname match, OR the current pathname is nested
//      under the item's href (prefix + '/'). This lets a nested
//      /admin/captains/[id] page still highlight the parent "Captains" link
//      when those detail pages ship.
//   4. /admin/requests special case: when ?city=other is on the URL, the
//      "Other-city Queue" item wins instead of "All Requests". This matters
//      because their pathnames are identical.
// =============================================================================

export function isAdminNavItemActive(
  item: AdminNavItem,
  currentPath: string,
  currentQuery?: URLSearchParams | null,
): boolean {
  if (item.placeholder || !item.href) return false;

  // Pathname must match exactly or be nested under the item href.
  const pathMatches =
    currentPath === item.href ||
    currentPath.startsWith(`${item.href}/`);
  if (!pathMatches) return false;

  // Query constraint check (Other-city Queue).
  if (item.query) {
    if (!currentQuery) return false;
    for (const [k, v] of Object.entries(item.query)) {
      if (currentQuery.get(k) !== v) return false;
    }
    return true;
  }

  // No query constraint on this item. If a different group item with a
  // query constraint would match the current URL, defer to that one —
  // so "All Requests" doesn't light up when the URL is /admin/requests?city=other.
  if (currentQuery) {
    for (const group of ADMIN_NAV) {
      for (const sibling of group.items) {
        if (
          sibling !== item &&
          sibling.href === item.href &&
          sibling.query
        ) {
          let allMatch = true;
          for (const [k, v] of Object.entries(sibling.query)) {
            if (currentQuery.get(k) !== v) {
              allMatch = false;
              break;
            }
          }
          if (allMatch) return false;
        }
      }
    }
  }

  return true;
}

// =============================================================================
// Page title resolution for the top bar
// =============================================================================
//
// The top bar reads the page title from a pathname lookup. Pages that
// aren't represented in ADMIN_NAV fall back to the last path segment,
// title-cased — adequate for "did the user just navigate?" feedback,
// and a no-op when the right entry is added to ADMIN_NAV later.
// =============================================================================

export function resolveAdminPageTitle(
  currentPath: string,
  currentQuery?: URLSearchParams | null,
): string {
  for (const group of ADMIN_NAV) {
    for (const item of group.items) {
      if (isAdminNavItemActive(item, currentPath, currentQuery)) {
        return item.label;
      }
    }
  }
  // Fallback: last segment, title-cased.
  const segments = currentPath.split('/').filter(Boolean);
  const last = segments[segments.length - 1] ?? 'admin';
  return last
    .replace(/[-_]/gu, ' ')
    .replace(/\b\w/gu, (m) => m.toUpperCase());
}
