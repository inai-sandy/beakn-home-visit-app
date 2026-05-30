import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { AssistListView } from '@/components/assist/AssistListView';
import { BackButton } from '@/components/ui/back-button';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { loadAssistList } from '@/lib/assist/queries';
import { isAssistStatus, isAssistType } from '@/lib/assist/parse';
import { getServerSession } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Assist — Beakn',
};

interface PageProps {
  searchParams: Promise<{
    type?: string;
    status?: string;
    q?: string;
    page?: string;
  }>;
}

export default async function ExecAssistListPage({ searchParams }: PageProps) {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/assist');
  const role = (session.user as { role?: string }).role;
  if (role !== 'sales_executive' && role !== 'super_admin') redirect('/login');

  const params = await searchParams;
  const type = isAssistType(params.type) ? params.type : undefined;
  const status = isAssistStatus(params.status) ? params.status : undefined;
  const search = params.q?.trim() ?? '';
  const page = Number.parseInt(params.page ?? '1', 10) || 1;
  const pageSize = 10;

  const { rows, total } = await loadAssistList({
    callerUserId: session.user.id,
    callerRole: 'sales_executive',
    type,
    status,
    search: search.length > 0 ? search : undefined,
    page,
    pageSize,
  });

  return (
    <main className="min-h-svh bg-background pb-12">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 space-y-5">
        <header className="flex items-center justify-between gap-3">
          <BackButton fallback="/today" variant="ghost" size="sm">
            Back
          </BackButton>
          <Button asChild size="sm" className="h-9">
            <Link href="/assist/new">
              <Icon name="add" size="xs" />
              New assist
            </Link>
          </Button>
        </header>
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">My assists</h1>
          <p className="text-sm text-muted-foreground">
            Material requests you've submitted. Tap a row for status + history.
          </p>
        </header>
        <AssistListView
          rows={rows}
          total={total}
          page={page}
          pageSize={pageSize}
          basePath="/assist"
          detailPath="/assist"
          showExec={false}
          currentType={type ?? 'all'}
          currentStatus={status ?? 'all'}
          currentSearch={search}
        />
      </div>
    </main>
  );
}
