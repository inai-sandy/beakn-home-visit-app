import type { Metadata } from 'next';
import Image from 'next/image';
import { redirect } from 'next/navigation';

import { ROLE_HOME, isRole } from '@/lib/auth/roles';
import { getServerSession } from '@/lib/auth-server';

import { SetPasswordForm } from './set-password-form';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Set your password — Beakn',
  description: 'Set your Beakn account password.',
};

// /set-password is the mandatory first-login step. HVA-25's proxy.ts pins
// authenticated users with mustChangePassword=true here. This server
// component adds two defense-in-depth checks the proxy already covers:
//
//   1. No session at all → /login. (Proxy already redirects, but if proxy
//      logic regresses or the page is hit from a non-matched context, we
//      catch it here.)
//   2. Session present + mustChangePassword=false → role home. Prevents
//      a user who already has a real password from re-submitting via this
//      form (which would skip the current-password check).
//
// Both checks are cheap (one getServerSession call) and keep the form's
// preconditions explicit at the page level too.
export default async function SetPasswordPage() {
  const session = await getServerSession();

  if (!session) {
    redirect('/login?next=%2Fset-password');
  }

  const user = session.user as {
    role?: string;
    mustChangePassword?: boolean;
  };

  if (!user.mustChangePassword) {
    redirect(isRole(user.role) ? ROLE_HOME[user.role] : '/');
  }

  return (
    <main className="min-h-svh flex flex-col items-center justify-center px-6 py-10 bg-background">
      <div className="w-full max-w-md flex flex-col items-center">
        <Image
          src="/icon-512x512.png"
          alt="Beakn"
          width={64}
          height={64}
          priority
          className="mb-5 rounded-2xl"
        />
        <h1 className="text-2xl font-semibold tracking-tight text-center mb-1">
          Welcome to Beakn — set your password
        </h1>
        <p className="text-sm text-muted-foreground text-center mb-8">
          For security, please choose a new password to continue.
        </p>

        <div className="w-full sm:rounded-3xl sm:border sm:bg-card sm:p-6 sm:shadow-sm">
          <SetPasswordForm />
        </div>
      </div>
    </main>
  );
}
