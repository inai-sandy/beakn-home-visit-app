import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { LeaderboardView } from '@/components/leaderboard/LeaderboardView';
import { getServerSession } from '@/lib/auth-server';
import { loadLeaderboard } from '@/lib/leaderboard/queries';
import { parseLeaderboardSearchParams } from '@/lib/leaderboard/page-helpers';

// HVA-201: /leaderboard — exec portal entry point.

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Leaderboard — Beakn',
};

interface PageProps {
  searchParams: Promise<{ window?: string; metric?: string }>;
}

export default async function ExecLeaderboardPage({ searchParams }: PageProps) {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/leaderboard');
  const role = (session.user as { role?: string }).role;
  if (role !== 'sales_executive' && role !== 'super_admin') redirect('/login');

  const sp = await searchParams;
  const { window, metric } = parseLeaderboardSearchParams(sp);
  const rows = await loadLeaderboard({ metric, window });

  return (
    <LeaderboardView
      rows={rows}
      viewerExecUserId={session.user.id}
      activeMetric={metric}
      activeWindow={window}
      basePath="/leaderboard"
    />
  );
}
