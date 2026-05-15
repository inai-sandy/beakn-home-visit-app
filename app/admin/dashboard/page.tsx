import { getServerSession } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

// Super-admin landing page. Full UI is HVA-88; for HVA-24 this is the
// placeholder the login redirect points to so the e2e flow doesn't 404.
export default async function AdminDashboardPage() {
  const session = await getServerSession();
  return (
    <main className="p-8 font-mono text-sm space-y-4">
      <h1 className="text-lg font-semibold">Admin dashboard (placeholder)</h1>
      <p className="text-muted-foreground">
        Full super-admin UI lands in HVA-88. You&apos;re seeing this because login
        succeeded and your role was <code>super_admin</code>.
      </p>
      <pre className="bg-muted p-4 rounded-md">
{JSON.stringify(
  { user: session?.user ?? null, sessionExpiresAt: session?.session?.expiresAt ?? null },
  null,
  2,
)}
      </pre>
    </main>
  );
}
