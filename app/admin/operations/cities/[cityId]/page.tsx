import { eq } from 'drizzle-orm';
import { notFound, redirect } from 'next/navigation';

import { db } from '@/db/client';
import { cities } from '@/db/schema';
import { getServerSession } from '@/lib/auth-server';

// =============================================================================
// /admin/operations/cities/[cityId] — redirect into the captain portal
// =============================================================================
//
// Sandeep 2026-06-03 Ship 1: the city tile on /admin/dashboard now
// links straight to /admin/portal/[captainId]/dashboard. This route
// remains as a back-compat redirect so any existing bookmarks or
// in-flight tabs still land somewhere sensible:
//   - city has a captain  → redirect to the captain's portal dashboard
//   - city has no captain → 404 (no portal to open; admin should fix
//     the city's captain assignment via Settings → Cities)
//
// The previous "clumsy" multi-section drill (window metrics + per-city
// captain surfaces + open requests + roster) was retired here because
// the same content lives inside the captain portal, scoped by the
// captain's actual ownership (which mixes cities — captain dashboard
// semantic). Sandeep: *"the city dashboard which is the captain portal
// is looking too clumsy"*.
// =============================================================================

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ cityId: string }>;
}

export default async function AdminCityDrillRedirect({ params }: PageProps) {
  const session = await getServerSession();
  if (!session) {
    const { cityId } = await params;
    redirect(`/login?next=/admin/operations/cities/${cityId}`);
  }
  if ((session.user as { role?: string }).role !== 'super_admin') {
    redirect('/admin/dashboard');
  }

  const { cityId } = await params;
  const [row] = await db
    .select({ captainUserId: cities.captainUserId })
    .from(cities)
    .where(eq(cities.id, cityId))
    .limit(1);

  if (!row) notFound();
  if (!row.captainUserId) notFound();

  redirect(`/admin/portal/${row.captainUserId}/dashboard`);
}
