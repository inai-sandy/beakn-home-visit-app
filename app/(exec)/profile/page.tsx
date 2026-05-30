import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { ProfileView } from '@/components/profile/ProfileView';
import { getServerSession } from '@/lib/auth-server';
import { loadProfileForUser } from '@/lib/profile/queries';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Profile — Beakn',
};

export default async function ExecProfilePage() {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/profile');
  const role = (session.user as { role?: string }).role;
  if (role !== 'sales_executive' && role !== 'super_admin') redirect('/login');

  const profile = await loadProfileForUser({
    userId: session.user.id,
    role: role === 'super_admin' ? 'super_admin' : 'sales_executive',
  });
  if (!profile) notFound();

  return (
    <main className="min-h-svh bg-background pb-12">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 space-y-5">
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
    </main>
  );
}
