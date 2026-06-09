import { redirect } from 'next/navigation';

import { USER_ROLES } from '@/lib/auth/roles';
import { getServerSession } from '@/lib/auth-server';
import { loadActiveCategories } from '@/lib/support-tickets/category-queries';
import {
  loadTicketsQueue,
  type QueueResult,
  type TicketStatusFilter,
} from '@/lib/support-tickets/queue-queries';

// =============================================================================
// HVA-256-FIX1: shared loader for the per-portal /tickets pages
// =============================================================================
//
// Three per-portal page files (admin / captain / exec) each delegate
// here so they share scope resolution + load logic. Each portal page
// then renders TicketsQueueClient with its own portal shell context.
// =============================================================================

export type PortalRole = 'sales_executive' | 'captain' | 'super_admin';

export interface PageInput {
  // The path of the calling page (used for the /login?next= redirect).
  portalPath: string;
  // The role this portal page is intended for. If the caller's role
  // doesn't match (or super_admin which can access any portal), we
  // redirect them to their own portal's tickets page.
  requiredRole: PortalRole;
  searchParams: Promise<{
    status?: string;
    category?: string;
    mine?: string;
    q?: string;
    page?: string;
  }>;
}

const PORTAL_HOME_BY_ROLE: Record<PortalRole, string> = {
  sales_executive: '/tickets',
  captain: '/captain/tickets',
  super_admin: '/admin/tickets',
};

function parseStatus(raw: string | undefined): TicketStatusFilter {
  if (
    raw === 'open' ||
    raw === 'in_progress' ||
    raw === 'resolved' ||
    raw === 'all'
  ) {
    return raw;
  }
  return 'open';
}

export interface LoadedPageData {
  queue: QueueResult;
  status: TicketStatusFilter;
  category: string;
  mineOnly: boolean;
  search: string;
  page: number;
  currentRole: PortalRole;
  categories: Awaited<ReturnType<typeof loadActiveCategories>>;
}

export async function loadTicketsPageData(
  input: PageInput,
): Promise<LoadedPageData> {
  const session = await getServerSession();
  if (!session) {
    redirect(`/login?next=${encodeURIComponent(input.portalPath)}`);
  }
  const user = session.user as { id: string; role?: string };

  // Role gate. super_admin can access any portal page; otherwise the
  // role must match exactly. Wrong-role users get redirected to their
  // portal home (NOT denied — the data is the same, just shelled
  // differently).
  if (
    user.role !== input.requiredRole &&
    user.role !== USER_ROLES.SUPER_ADMIN
  ) {
    const role = user.role as PortalRole | undefined;
    if (role && role in PORTAL_HOME_BY_ROLE) {
      redirect(PORTAL_HOME_BY_ROLE[role]);
    }
    redirect('/login');
  }

  const callerRole = user.role as PortalRole;
  const params = await input.searchParams;
  const status = parseStatus(params.status);
  const category = (params.category ?? 'all').trim() || 'all';
  const mineOnly = params.mine === '1';
  const search = (params.q ?? '').trim();
  const page = Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1);

  const [queue, categories] = await Promise.all([
    loadTicketsQueue({
      callerRole,
      callerUserId: user.id,
      status,
      // queue-queries accepts string for category filter; 'all' = no filter
      category: category as Parameters<typeof loadTicketsQueue>[0]['category'],
      mineOnly,
      search: search || undefined,
      page,
      pageSize: 25,
    }),
    loadActiveCategories(),
  ]);

  return {
    queue,
    status,
    category,
    mineOnly,
    search,
    page: queue.page,
    currentRole: callerRole,
    categories,
  };
}
