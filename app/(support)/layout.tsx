import { redirect } from 'next/navigation';

import { getServerSession } from '@/lib/auth-server';
import { decideSupportAccess } from '@/lib/support-authz';

import { SupportSidebar } from './_components/SupportSidebar';
import { SupportTopbar } from './_components/SupportTopbar';

// =============================================================================
// HVA-235 (HVA-231 Phase 1.1): /support/* shell
// =============================================================================
//
// Wraps every /support/* page with the persistent 240px sidebar + 56dp
// top bar. Mirrors the exec + captain shells but trimmed: no
// notification bell (lands in Phase 2 with dispatch events), no
// announcements (none target the support role in v1), no push prompt
// (Phase 2).
//
// Auth gate via decideSupportAccess (defence in depth on top of
// proxy.ts). Only `support` role lands here; other roles bounce to
// their ROLE_HOME.
// =============================================================================

export const dynamic = 'force-dynamic';

export default async function SupportLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession();
  const decision = decideSupportAccess(session, '/support');
  if (!decision.allow) {
    redirect(decision.redirectTo);
  }

  const user = session!.user as { name?: string; fullName?: string };
  const fullName = user.fullName ?? user.name ?? 'Support';

  return (
    <div className="min-h-svh flex bg-background">
      {/* Desktop sidebar hidden below lg. Mobile drawer lands in Phase 2. */}
      <div className="hidden lg:flex">
        <SupportSidebar fullName={fullName} />
      </div>

      <div className="flex-1 min-w-0 flex flex-col">
        <SupportTopbar />
        <main className="flex-1 px-4 sm:px-6 py-6 mx-auto w-full max-w-4xl">
          {children}
        </main>
      </div>
    </div>
  );
}
