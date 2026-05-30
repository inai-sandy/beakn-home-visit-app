import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { ProfileView } from '@/components/profile/ProfileView';
import { getServerSession } from '@/lib/auth-server';
import { loadProfileForUser } from '@/lib/profile/queries';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Profile — Beakn captain',
};

export default async function CaptainProfilePage() {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/captain/profile');
  const role = (session.user as { role?: string }).role;
  if (role !== 'captain' && role !== 'super_admin') redirect('/login');

  const profile = await loadProfileForUser({
    userId: session.user.id,
    role: role === 'super_admin' ? 'super_admin' : 'captain',
  });
  if (!profile) notFound();

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
        <p className="text-sm text-muted-foreground">
          Manage your account, theme, alerts, and password.
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
