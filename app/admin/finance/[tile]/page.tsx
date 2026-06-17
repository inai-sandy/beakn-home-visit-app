import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { getServerSession } from '@/lib/auth-server';
import { parsePage } from '@/lib/pagination';

import {
  FinanceTileDetailPage,
  isFinanceTileSlug,
} from '@/app/(captain)/captain/collections/_components/FinanceTileDetailPage';

// =============================================================================
// HVA-297: /admin/finance/[tile] — org-wide finance tile detail (position
// tiles: order-book / pipeline / received / outstanding / credits-owed).
// Reuses the shared detail component at super-admin scope.
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Finance detail — Beakn admin' };

interface PageProps {
  params: Promise<{ tile: string }>;
  searchParams: Promise<{ page?: string }>;
}

export default async function AdminFinanceTilePage({
  params,
  searchParams,
}: PageProps) {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/admin/finance');
  const user = session.user as { id: string; role?: string };
  if (user.role !== 'super_admin') redirect('/login');

  const { tile } = await params;
  if (!isFinanceTileSlug(tile)) notFound();

  const sp = await searchParams;

  return (
    <FinanceTileDetailPage
      slug={tile}
      page={parsePage(sp.page)}
      backHref="/admin/finance"
      backLabel="Back to Finance"
      scope={{ captainUserId: user.id, isSuperAdmin: true }}
    />
  );
}
