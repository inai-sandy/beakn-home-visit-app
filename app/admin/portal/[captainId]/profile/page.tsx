import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ProfileView } from '@/components/profile/ProfileView';
import { loadProfileForUser } from '@/lib/profile/queries';

// Mirror of /captain/profile, scoped to the URL captainId. Admin sees
// the captain's profile fields; edit actions on the underlying
// component would target the admin's own session at the action layer,
// so they're functionally inert here.

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Captain profile — Beakn admin',
};

export default async function AdminPortalProfilePage({
  params,
}: {
  params: Promise<unknown>;
}) {
  const { captainId } = (await params) as { captainId: string };
  const profile = await loadProfileForUser({
    userId: captainId,
    role: 'captain',
  });
  if (!profile) notFound();

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Captain profile
        </h1>
        <p className="text-sm text-muted-foreground">
          View-only mirror — edits are not applied to this captain's account.
        </p>
      </header>
      <ProfileView
        profile={profile}
        appVersion={{
          commitSha: process.env.NEXT_PUBLIC_COMMIT_SHA ?? 'dev',
          buildDate: process.env.NEXT_PUBLIC_BUILD_DATE ?? 'dev',
        }}
      />
    </div>
  );
}
