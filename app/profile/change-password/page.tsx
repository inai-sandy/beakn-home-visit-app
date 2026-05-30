import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { BackButton } from '@/components/ui/back-button';
import { getServerSession } from '@/lib/auth-server';
import { ROLE_HOME, isRole } from '@/lib/auth/roles';

import { ChangePasswordForm } from './change-password-form';

// HVA-76: Change password page surfaced from the Profile screen.
// HVA-29's form lifted here from /dev/change-password-test (which now
// 308-redirects here for any external links / muscle memory).

export const metadata: Metadata = {
  title: 'Change password — Beakn',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function ChangePasswordPage() {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/profile/change-password');

  const role = (session.user as { role?: string }).role;
  const fallback = isRole(role) ? ROLE_HOME[role] : '/profile';

  return (
    <main className="min-h-svh bg-background">
      <div className="mx-auto max-w-md px-4 sm:px-6 py-6 space-y-5">
        <BackButton fallback={fallback} variant="ghost" size="sm">
          Back
        </BackButton>

        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Change password
          </h1>
          <p className="text-sm text-muted-foreground">
            Updating your password will sign you out of all other devices.
            This device stays signed in.
          </p>
        </header>

        <section className="rounded-2xl border bg-card p-5 shadow-sm">
          <ChangePasswordForm />
        </section>
      </div>
    </main>
  );
}
