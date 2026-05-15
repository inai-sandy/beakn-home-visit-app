import { getServerSession } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

// Placeholder for HVA-26 (Set Your Password — mandatory first-login change).
// HVA-25's proxy.ts pins authenticated users with mustChangePassword=true to
// this route. The real form (current password / new password / confirm new
// password + Zod validation + submit handler that flips the flag) lands in
// HVA-26.
export default async function SetPasswordPage() {
  const session = await getServerSession();
  return (
    <main className="p-8 font-mono text-sm space-y-4">
      <h1 className="text-lg font-semibold">Set your password (placeholder)</h1>
      <p className="text-muted-foreground">
        Full Set-Password UI lands in HVA-26. You&apos;re seeing this because
        either (a) <code>mustChangePassword=true</code> pinned you here, or
        (b) you navigated to <code>/set-password</code> directly.
      </p>
      <pre className="bg-muted p-4 rounded-md">
{JSON.stringify(
  {
    user: session?.user
      ? {
          id: session.user.id,
          role: (session.user as { role?: string }).role ?? null,
          mustChangePassword:
            (session.user as { mustChangePassword?: boolean }).mustChangePassword ?? null,
        }
      : null,
  },
  null,
  2,
)}
      </pre>
    </main>
  );
}
