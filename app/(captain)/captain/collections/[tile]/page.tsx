import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { getServerSession } from '@/lib/auth-server';
import { parsePage } from '@/lib/pagination';

import {
  FinanceTileDetailPage,
  isFinanceTileSlug,
} from '../_components/FinanceTileDetailPage';

// =============================================================================
// /captain/collections/[tile] — dedicated detail pages for each of the
// 4 Finance hero tiles. Sandeep 2026-06-03: tiles must open a real
// page with a proper table, not a slide-over sheet.
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Finance detail — Captain',
};

interface PageProps {
  params: Promise<{ tile: string }>;
  searchParams: Promise<{
    exec?: string;
    city?: string;
    page?: string;
  }>;
}

export default async function CaptainFinanceTilePage({
  params,
  searchParams,
}: PageProps) {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/captain/collections');
  const user = session.user as { id: string; role?: string };
  if (user.role !== 'captain' && user.role !== 'super_admin') {
    redirect('/login');
  }

  const { tile } = await params;
  if (!isFinanceTileSlug(tile)) notFound();

  const sp = await searchParams;
  const execFilter = sp.exec && sp.exec !== 'all' ? sp.exec : undefined;
  const cityFilter = sp.city && sp.city !== 'all' ? sp.city : undefined;

  return (
    <FinanceTileDetailPage
      slug={tile}
      page={parsePage(sp.page)}
      backHref="/captain/collections"
      backLabel="Back to Finance"
      scope={{
        captainUserId: user.id,
        isSuperAdmin: user.role === 'super_admin',
        execFilter,
        cityFilter,
      }}
    />
  );
}
