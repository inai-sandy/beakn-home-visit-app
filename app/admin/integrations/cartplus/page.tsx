import { redirect } from 'next/navigation';

import { getServerSession } from '@/lib/auth-server';
import { loadCartplusSecrets } from '@/lib/admin/cartplus';

import { SecretsClient } from './SecretsClient';

// =============================================================================
// HVA-248 (HVA-230): /admin/integrations/cartplus
// =============================================================================
//
// Lists CartPlus webhook signing secrets + lets super_admin generate or
// revoke them. The plaintext secret is shown ONLY in the generate modal
// (one-shot); after that, only the preview (first 4 + ellipsis + last 4)
// is ever visible. Generating a new secret auto-revokes the previous active.
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'CartPlus secrets — Admin — Beakn',
};

export default async function CartplusSecretsPage() {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/admin/integrations/cartplus');
  const user = session.user as { id: string; role?: string };
  if (user.role !== 'super_admin') redirect('/admin/dashboard');

  const secrets = await loadCartplusSecrets();

  return (
    <main className="min-h-svh bg-background">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 py-6 space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            CartPlus webhook secrets
          </h1>
          <p className="text-sm text-muted-foreground">
            Generate the signing secret you give to CartPlus. We use it to
            verify <code>X-CartPlus-Signature</code> on every incoming
            delivery. At most one active secret at a time; generating a new
            one revokes the old one automatically.
          </p>
        </header>

        <SecretsClient secrets={secrets} />
      </div>
    </main>
  );
}
