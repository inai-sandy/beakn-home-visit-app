import type { ResourceVisibility } from '@/lib/content/types';

// =============================================================================
// HVA-156-FIX2 + HVA-121: resource visibility scoping
// =============================================================================
//
// Pure function — no DB access. Decides whether a given viewer role can
// see a resource of a given visibility. Mirrors the SQL filter applied on
// the read queries (see lib/content/queries.ts:loadPublishedResources)
// so the UI and DB layer agree.
//
// Captain sees: all + captains_only
// Sales exec sees: all + sales_execs_only
// super_admin sees: everything (the admin surface uses loadAllResourcesForAdmin)
//
// The two role-restricted bands are mutually exclusive on purpose — a
// resource flagged 'captains_only' must not be discoverable on the exec
// surface even with a direct URL, and vice versa.
// =============================================================================

type ViewerRole = 'sales_executive' | 'captain' | 'super_admin';

export function canSeeResource(
  viewerRole: ViewerRole | string | undefined,
  resourceVisibility: ResourceVisibility,
): boolean {
  if (viewerRole === 'super_admin') return true;
  if (resourceVisibility === 'all') return true;
  if (viewerRole === 'captain') return resourceVisibility === 'captains_only';
  if (viewerRole === 'sales_executive') {
    return resourceVisibility === 'sales_execs_only';
  }
  return false;
}

/** Visibility values a given viewer role is allowed to see, including 'all'.
 *  Used to build the SQL `IN (...)` clause in loadPublishedResources. */
export function allowedVisibilitiesForRole(
  viewerRole: ViewerRole | string | undefined,
): ResourceVisibility[] {
  if (viewerRole === 'super_admin') {
    return ['all', 'captains_only', 'sales_execs_only'];
  }
  if (viewerRole === 'captain') return ['all', 'captains_only'];
  if (viewerRole === 'sales_executive') return ['all', 'sales_execs_only'];
  return [];
}
