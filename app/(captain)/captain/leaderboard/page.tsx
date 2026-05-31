import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { LeaderboardView } from '@/components/leaderboard/LeaderboardView';
import { getServerSession } from '@/lib/auth-server';
import { loadLeaderboard } from '@/lib/leaderboard/queries';
import { parseLeaderboardSearchParams } from '@/lib/leaderboard/page-helpers';

// HVA-201: /captain/leaderboard — captain portal entry point.
// Same content as the exec route; captain views their team in context
// of the full global ranking. Captain themselves don't appear as a
// ranked row (the leaderboard is exec-only).

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Leaderboard — Captain',
};

interface PageProps {
  searchParams: Promise<{ window?: string; metric?: string }>;
}

export default async function CaptainLeaderboardPage({ searchParams }: PageProps) {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/captain/leaderboard');
  const role = (session.user as { role?: string }).role;
  if (role !== 'captain' && role !== 'super_admin') redirect('/login');

  const sp = await searchParams;
  const { window, metric } = parseLeaderboardSearchParams(sp);
  const rows = await loadLeaderboard({ metric, window });

  return (
    <LeaderboardView
      rows={rows}
      viewerExecUserId={null}
      activeMetric={metric}
      activeWindow={window}
      basePath="/captain/leaderboard"
    />
  );
}
