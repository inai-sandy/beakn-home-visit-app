import type { Metadata } from 'next';

import { LeaderboardView } from '@/components/leaderboard/LeaderboardView';
import { loadLeaderboard } from '@/lib/leaderboard/queries';
import { parseLeaderboardSearchParams } from '@/lib/leaderboard/page-helpers';

// Read-only mirror of /captain/leaderboard. Same global leaderboard
// data; the only difference is the URL the LeaderboardView writes back
// to (so toggling metric / window stays inside the admin portal).

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Leaderboard — Beakn admin',
};

interface PageProps {
  params: Promise<unknown>;
  searchParams: Promise<{
    date?: string;
    from?: string;
    to?: string;
    metric?: string;
  }>;
}

export default async function AdminPortalLeaderboardPage({
  params,
  searchParams,
}: PageProps) {
  const { captainId } = (await params) as { captainId: string };
  const sp = await searchParams;
  const { window, metric } = parseLeaderboardSearchParams(sp);
  const rows = await loadLeaderboard({ metric, window });

  const preservedQuery: Record<string, string> = {};
  if (sp.date) preservedQuery.date = sp.date;
  if (sp.from) preservedQuery.from = sp.from;
  if (sp.to) preservedQuery.to = sp.to;

  return (
    <LeaderboardView
      rows={rows}
      viewerExecUserId={null}
      activeMetric={metric}
      activeWindow={window}
      basePath={`/admin/portal/${captainId}/leaderboard`}
      preservedQuery={preservedQuery}
    />
  );
}
