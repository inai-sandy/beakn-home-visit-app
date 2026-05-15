import { getServerSession } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

// Sales-exec landing page. Full UI is HVA-57; for HVA-24 this is the
// placeholder the login redirect points to so the e2e flow doesn't 404.
export default async function TodayPage() {
  const session = await getServerSession();
  return (
    <main className="p-8 font-mono text-sm space-y-4">
      <h1 className="text-lg font-semibold">Today (placeholder)</h1>
      <p className="text-muted-foreground">
        Full sales-exec dashboard lands in HVA-57. You&apos;re seeing this because
        login succeeded and your role was <code>sales_executive</code>.
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
