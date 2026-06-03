import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { parsePage } from '@/lib/pagination';

import {
  FinanceTileDetailPage,
  isFinanceTileSlug,
} from '@/app/(captain)/captain/collections/_components/FinanceTileDetailPage';

// =============================================================================
// /admin/portal/[captainId]/collections/[tile] — admin view (read-only)
// of the captain's Finance tile detail. Parent /admin/portal layout
// gates super_admin; we trust the URL captainId.
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Finance detail — Beakn admin',
};

interface PageProps {
  params: Promise<unknown>;
  searchParams: Promise<{
    exec?: string;
    city?: string;
    page?: string;
  }>;
}

export default async function AdminPortalFinanceTilePage({
  params,
  searchParams,
}: PageProps) {
  const { captainId, tile } = (await params) as {
    captainId: string;
    tile: string;
  };
  if (!isFinanceTileSlug(tile)) notFound();

  const sp = await searchParams;
  const execFilter = sp.exec && sp.exec !== 'all' ? sp.exec : undefined;
  const cityFilter = sp.city && sp.city !== 'all' ? sp.city : undefined;
  const backHref = `/admin/portal/${captainId}/collections`;

  return (
    <FinanceTileDetailPage
      slug={tile}
      page={parsePage(sp.page)}
      backHref={backHref}
      backLabel="Back to Finance"
      scope={{
        captainUserId: captainId,
        isSuperAdmin: false,
        execFilter,
        cityFilter,
      }}
    />
  );
}
