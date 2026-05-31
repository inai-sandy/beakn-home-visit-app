import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { LeaderboardView } from '@/components/leaderboard/LeaderboardView';
import { getServerSession } from '@/lib/auth-server';
import { loadLeaderboard } from '@/lib/leaderboard/queries';
import { parseLeaderboardSearchParams } from '@/lib/leaderboard/page-helpers';

// HVA-201: /admin/leaderboard — admin portal entry point.
// Same content as the exec/captain routes; super_admin sees the global
// ranking and can use the metric/time filters for board-level reporting.

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Leaderboard — Beakn admin',
};

interface PageProps {
  searchParams: Promise<{ window?: string; metric?: string }>;
}

export default async function AdminLeaderboardPage({ searchParams }: PageProps) {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/admin/leaderboard');
  const role = (session.user as { role?: string }).role;
  if (role !== 'super_admin') redirect('/login');

  const sp = await searchParams;
  const { window, metric } = parseLeaderboardSearchParams(sp);
  const rows = await loadLeaderboard({ metric, window });

  return (
    <LeaderboardView
      rows={rows}
      viewerExecUserId={null}
      activeMetric={metric}
      activeWindow={window}
      basePath="/admin/leaderboard"
    />
  );
}
