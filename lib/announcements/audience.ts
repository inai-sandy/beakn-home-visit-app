import type { AnnouncementAudience } from '@/lib/content/types';

// =============================================================================
// HVA-156-FIX2 + HVA-120: announcement audience scoping
// =============================================================================
//
// Pure function — no DB. Decides whether a given viewer role can see an
// announcement of a given audience. Mirrors the SQL filter in
// loadPublishedAnnouncementsForUser.
//
//   audience='sales_executive' → only execs see it
//   audience='captain'         → only captains see it
//   audience='both'            → both execs + captains see it
//   super_admin                → sees everything via admin surface
// =============================================================================

type ViewerRole = 'sales_executive' | 'captain' | 'super_admin';

export function canSeeAnnouncement(
  viewerRole: ViewerRole | string | undefined,
  audience: AnnouncementAudience,
): boolean {
  if (viewerRole === 'super_admin') return true;
  if (audience === 'both') return true;
  if (viewerRole === 'captain') return audience === 'captain';
  if (viewerRole === 'sales_executive') return audience === 'sales_executive';
  return false;
}

/** Audience values a viewer role is allowed to see, plus 'both'. Used to
 *  build the SQL `IN (...)` clause in loadPublishedAnnouncementsForUser. */
export function allowedAudiencesForRole(
  viewerRole: ViewerRole | string | undefined,
): AnnouncementAudience[] {
  if (viewerRole === 'super_admin') {
    return ['sales_executive', 'captain', 'both'];
  }
  if (viewerRole === 'captain') return ['captain', 'both'];
  if (viewerRole === 'sales_executive') return ['sales_executive', 'both'];
  return [];
}
