import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { getServerSession } from '@/lib/auth-server';
import { parsePage } from '@/lib/pagination';

import {
  FinanceTileDetailPage,
  isFinanceTileSlug,
} from '@/app/(captain)/captain/collections/_components/FinanceTileDetailPage';

// =============================================================================
// /finance/[tile] — exec self-view Finance hero tile detail pages.
// Scope pinned to assigned_exec_user_id = self via `forceExecScope`.
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Finance detail — Beakn',
};

interface PageProps {
  params: Promise<{ tile: string }>;
  searchParams: Promise<{ page?: string }>;
}

export default async function ExecFinanceTilePage({
  params,
  searchParams,
}: PageProps) {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/finance');
  const user = session.user as { id: string; role?: string };
  if (user.role !== 'sales_executive' && user.role !== 'super_admin') {
    redirect('/login');
  }

  const { tile } = await params;
  if (!isFinanceTileSlug(tile)) notFound();

  const sp = await searchParams;

  return (
    <FinanceTileDetailPage
      slug={tile}
      page={parsePage(sp.page)}
      backHref="/finance"
      backLabel="Back to Finance"
      scope={{
        captainUserId: user.id, // unused when forceExecScope set
        isSuperAdmin: false,
        forceExecScope: user.id,
      }}
    />
  );
}
