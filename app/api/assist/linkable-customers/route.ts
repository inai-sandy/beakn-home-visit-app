import { NextResponse } from 'next/server';

import { getServerSession } from '@/lib/auth-server';
import { loadLinkableVisitRequestsForExec } from '@/lib/assist/queries';

// HVA-199 follow-up: search endpoint for the assist form's "Link to a
// customer" combobox. Drop the bounded preload; the form fires this on
// every keystroke (debounced client-side) so teams with hundreds of
// active requests stay searchable.
//
// Scope: always the caller's own assigned visit_requests (the existing
// query already restricts to `assigned_exec_user_id = me`). Super_admin
// is allowed to hit this for parity but gets their own request set (none
// in practice).

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const role = (session.user as { role?: string }).role;
  if (role !== 'sales_executive' && role !== 'super_admin') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const url = new URL(request.url);
  const q = (url.searchParams.get('q') ?? '').trim();
  // Cap the response size — the combobox only displays N rows; anything
  // beyond is wasted bandwidth on mobile.
  const limit = 20;

  const rows = await loadLinkableVisitRequestsForExec({
    execUserId: session.user.id,
    search: q.length > 0 ? q : undefined,
    limit,
  });
  return NextResponse.json({ rows });
}
