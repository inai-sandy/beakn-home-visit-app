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

/** Accordion subgroup — used inside the Settings group per the HVA-89
 *  6-card spec. Operations + Reports stay flat (no subgroups); Settings
 *  is the only group today that uses subgroups. */
export interface AdminNavSubgroup {
  label: string;
  icon: string;
  items: AdminNavItem[];
  /** When true, render the subgroup as a disabled placeholder with
   *  "Coming soon" — used for the 3 HVA-89 cards that have no shipped
   *  pages yet (Workflow & Status / Targets / AI & Report Cards). */
  comingSoon?: true;
}

export interface AdminNavGroup {
  /** Small-caps group header text in the sidebar. */
  label: string;
  /** Flat list of leaf items. Used by Operations + Reports groups. Mutually
   *  exclusive with `subgroups`. */
  items?: AdminNavItem[];
  /** Hierarchical subgroups (accordion). Used by the Settings group per
   *  HVA-89. Mutually exclusive with `items`. */
  subgroups?: AdminNavSubgroup[];
}

// HVA-89: All configuration surfaces live under /admin/settings/<group>/<page>.
// The Settings group renders as collapsible accordions per the HVA-89 6-card
// spec — three subgroups have shipped pages (Organization / Audit & Content /
// Notifications); the other three (Workflow & Status / Targets / AI & Report
// Cards) render as disabled "Coming soon" placeholders so the full Phase-1
// roadmap is visible from the sidebar.
export const ADMIN_NAV: AdminNavGroup[] = [
  {
    label: 'Operations',
    items: [
      { label: 'Dashboard', icon: 'dashboard', href: '/admin/dashboard' },
      // HVA-95-FOLLOWUP: All Requests admin page is still unbuilt; mark
      // placeholder until that ticket ships so the link stops 404'ing.
      { label: 'All Requests', icon: 'list_alt', placeholder: true },
      {
        label: 'Other-city Queue',
        icon: 'priority_high',
        href: '/admin/operations/other-city',
      },
      {
        label: 'Admin Help Inbox',
        icon: 'help_center',
        href: '/admin/operations/admin-help',
      },
      // HVA-199: global queue of all assist requests across teams.
      {
        label: 'Assist Requests',
        icon: 'support_agent',
        href: '/admin/operations/assist',
      },
      // HVA-201: global exec leaderboard.
      {
        label: 'Leaderboard',
        icon: 'leaderboard',
        href: '/admin/leaderboard',
      },
    ],
  },
  {
    label: 'Settings',
    subgroups: [
      {
        label: 'Organization',
        icon: 'corporate_fare',
        items: [
          {
            label: 'Cities',
            icon: 'location_city',
            href: '/admin/settings/organization/cities',
          },
          {
            label: 'Captains',
            icon: 'shield_person',
            href: '/admin/settings/organization/captains',
          },
          {
            label: 'Executives',
            icon: 'badge',
            href: '/admin/settings/organization/executives',
          },
        ],
      },
      {
        label: 'Audit & Content',
        icon: 'fact_check',
        items: [
          {
            label: 'Resources',
            icon: 'menu_book',
            href: '/admin/settings/audit-content/resources',
          },
          {
            label: 'Resource Categories',
            icon: 'label',
            href: '/admin/settings/audit-content/categories',
          },
          {
            label: 'Announcements',
            icon: 'campaign',
            href: '/admin/settings/audit-content/announcements',
          },
          {
            label: 'Announcement Categories',
            icon: 'bookmarks',
            href: '/admin/settings/audit-content/announcement-categories',
          },
        ],
      },
      {
        label: 'Notifications',
        icon: 'notifications_active',
        items: [
          {
            label: 'Customer Support Phone',
            icon: 'support_agent',
            href: '/admin/settings/notifications/customer-support-phone',
          },
        ],
      },
      {
        label: 'Workflow & Status',
        icon: 'rule',
        items: [
          {
            label: 'Holidays',
            icon: 'event',
            href: '/admin/settings/workflow/holidays',
          },
        ],
      },
      {
        label: 'Targets',
        icon: 'flag',
        items: [],
        comingSoon: true,
      },
      {
        label: 'AI & Report Cards',
        icon: 'auto_awesome',
        items: [],
        comingSoon: true,
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

/** Returns every leaf nav item across both flat and subgroup-bearing groups.
 *  Used by `resolveAdminPageTitle` and tests to assert overall structure. */
export function flatAdminNavItems(): AdminNavItem[] {
  const out: AdminNavItem[] = [];
  for (const g of ADMIN_NAV) {
    if (g.items) out.push(...g.items);
    if (g.subgroups) {
      for (const sg of g.subgroups) out.push(...sg.items);
    }
  }
  return out;
}

/** True when any leaf inside the subgroup matches the current URL. Drives
 *  the accordion's default-expanded state. */
export function isAdminNavSubgroupActive(
  subgroup: AdminNavSubgroup,
  currentPath: string,
  currentQuery?: URLSearchParams | null,
): boolean {
  if (subgroup.comingSoon) return false;
  return subgroup.items.some((it) =>
    isAdminNavItemActive(it, currentPath, currentQuery),
  );
}

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
//      /admin/settings/organization/captains/[id] page still highlight the parent "Captains" link
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
    for (const sibling of flatAdminNavItems()) {
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
  for (const item of flatAdminNavItems()) {
    if (isAdminNavItemActive(item, currentPath, currentQuery)) {
      return item.label;
    }
  }
  // Fallback: last segment, title-cased.
  const segments = currentPath.split('/').filter(Boolean);
  const last = segments[segments.length - 1] ?? 'admin';
  return last
    .replace(/[-_]/gu, ' ')
    .replace(/\b\w/gu, (m) => m.toUpperCase());
}
