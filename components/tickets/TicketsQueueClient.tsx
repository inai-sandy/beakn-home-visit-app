'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

import { AnimatedLi, AnimatedList } from '@/components/motion/motion-kit';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useServerMutation } from '@/lib/hooks/use-server-mutation';
import {
  claimTicketAction,
  resolveTicketAction,
} from '@/lib/support-tickets/actions';
import type { TicketCategoryRow } from '@/lib/support-tickets/category-queries';
import type { QueueRow } from '@/lib/support-tickets/queue-queries';
import { cn } from '@/lib/utils';

// =============================================================================
// HVA-256-FIX2: queue UI — canonical HVA design language
// =============================================================================
//
// Matches the patterns used by /captain/approvals + /admin/operations/requests:
//   - Filter chip strip with `rounded-full border px-3 py-1 text-xs`
//     (same shape as RequestBucketTabs / approvals filters)
//   - shadcn <Select> for category (NOT raw <select>)
//   - Row cards use `rounded-3xl border bg-card p-5 shadow-sm space-y-4`
//   - Empty state mirrors approvals: rounded-3xl muted card
// =============================================================================

const STATUS_STYLE: Record<
  'open' | 'in_progress' | 'resolved',
  { label: string; cls: string }
> = {
  open: {
    label: 'Open',
    cls: 'bg-amber-500/10 text-amber-700 border-amber-500/30',
  },
  in_progress: {
    label: 'In progress',
    cls: 'bg-sky-500/10 text-sky-700 border-sky-500/30',
  },
  resolved: {
    label: 'Resolved',
    cls: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/30',
  },
};

interface Props {
  rows: QueueRow[];
  status: 'open' | 'in_progress' | 'resolved' | 'all';
  category: string;
  mineOnly: boolean;
  search: string;
  page: number;
  pageSize: number;
  totalCount: number;
  currentRole: 'sales_executive' | 'captain' | 'super_admin';
  categories: TicketCategoryRow[];
}

const STATUS_TABS: Array<{ value: Props['status']; label: string }> = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'all', label: 'All' },
];

function relativeTime(when: Date): string {
  const diffMs = Date.now() - when.getTime();
  const m = Math.floor(diffMs / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min${m === 1 ? '' : 's'} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr${h === 1 ? '' : 's'} ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`;
  return when.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export function TicketsQueueClient({
  rows,
  status,
  category,
  mineOnly,
  search,
  page,
  pageSize,
  totalCount,
  currentRole,
  categories,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  // eslint-disable-next-line no-restricted-syntax -- URL push
  const [, startTransition] = useTransition();

  const [searchInput, setSearchInput] = useState(search);

  const categoryByCode = new Map(categories.map((c) => [c.code, c.name]));

  // Debounced search → URL push
  useEffect(() => {
    const trimmed = searchInput.trim();
    if (trimmed === search) return;
    const h = setTimeout(() => {
      pushParam('q', trimmed.length > 0 ? trimmed : null);
    }, 300);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput, search]);

  function pushParam(key: string, value: string | null) {
    const next = new URLSearchParams(params.toString());
    if (value && value.length > 0) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    const qs = next.toString();
    startTransition(() =>
      router.push(qs ? `${pathname}?${qs}` : pathname),
    );
  }

  return (
    <div className="space-y-5">
      {/* Status chip strip — matches RequestBucketTabs pattern */}
      <nav
        aria-label="Filter by status"
        className="flex flex-wrap gap-1.5 border-b pb-3"
      >
        {STATUS_TABS.map((t) => {
          const isActive = status === t.value;
          return (
            <button
              type="button"
              key={t.value}
              onClick={() =>
                pushParam('status', t.value === 'open' ? null : t.value)
              }
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                isActive
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-muted-foreground/20 text-muted-foreground hover:bg-muted/60 hover:text-foreground',
              )}
            >
              {t.label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => pushParam('mine', mineOnly ? null : '1')}
          aria-pressed={mineOnly}
          className={cn(
            'ml-auto inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
            mineOnly
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-muted-foreground/20 text-muted-foreground hover:bg-muted/60 hover:text-foreground',
          )}
        >
          <Icon name="person" size="xs" />
          My tickets
        </button>
      </nav>

      {/* Filter bar — search + category, matches ApprovalsFiltersBar shape */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border bg-muted/30 px-4 py-3">
        <Input
          type="search"
          placeholder="Search customer name, phone, or subject"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="h-11 flex-1 min-w-[220px] bg-background"
        />
        <Select
          value={category}
          onValueChange={(v) => pushParam('category', v === 'all' ? null : v)}
        >
          <SelectTrigger className="h-11 sm:w-56" aria-label="Filter by category">
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.code} value={c.code}>
                {c.name}
                {!c.isActive ? ' (inactive)' : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Rows */}
      {rows.length === 0 ? (
        <div className="rounded-3xl border bg-muted/40 p-10 text-center">
          <Icon
            name="inbox"
            size="lg"
            className="text-muted-foreground/70 mx-auto"
          />
          <p className="text-sm text-muted-foreground mt-3">
            {status === 'open'
              ? 'No open tickets right now. Customers will appear here when they raise one.'
              : status === 'resolved'
                ? 'No resolved tickets match the current filter.'
                : 'No tickets match the current filter.'}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {/* HVA-269: claimed/resolved rows collapse out of the current
              filter; survivors glide up. */}
          <AnimatedList>
            {rows.map((r) => (
              <TicketRow
                key={r.ticketId}
                row={r}
                currentRole={currentRole}
                categoryLabel={categoryByCode.get(r.category) ?? r.category}
              />
            ))}
          </AnimatedList>
        </ul>
      )}

      <Pagination
        page={page}
        pageSize={pageSize}
        totalCount={totalCount}
        onGoto={(p) => pushParam('page', p > 1 ? String(p) : null)}
      />
    </div>
  );
}

function TicketRow({
  row,
  currentRole,
  categoryLabel,
}: {
  row: QueueRow;
  currentRole: 'sales_executive' | 'captain' | 'super_admin';
  categoryLabel: string;
}) {
  const status = STATUS_STYLE[row.status];
  const opened = new Date(row.openedAt);

  const { mutate: doClaim, isPending: claiming } = useServerMutation(
    claimTicketAction,
    { successMessage: 'Claimed — you own this ticket now' },
  );
  const { mutate: doResolve, isPending: resolving } = useServerMutation(
    resolveTicketAction,
    { successMessage: 'Resolved — customer sees it on /track' },
  );

  const canClaim = row.status === 'open';
  const canResolve =
    row.status === 'in_progress' ||
    (currentRole === 'super_admin' && row.status === 'open');

  return (
    <AnimatedLi className="rounded-3xl border bg-card p-5 shadow-sm space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2 flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className={cn('text-[10px]', status.cls)}>
              {status.label}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {categoryLabel}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {relativeTime(opened)}
            </span>
          </div>
          <h3 className="text-base font-semibold tracking-tight">
            {row.subject}
          </h3>
          <p className="text-sm text-muted-foreground">
            {row.customerName} ·{' '}
            <span className="font-medium text-foreground/70">
              {row.customerPhone}
            </span>{' '}
            · {row.cityName}
          </p>
          {row.claimedByName ? (
            <p className="text-xs text-muted-foreground">
              Owner:{' '}
              <span className="font-medium text-foreground/80">
                {row.claimedByName}
              </span>
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href={`/requests/${row.requestId}`}>
            <Icon name="open_in_new" size="xs" />
            Open order
          </Link>
        </Button>
        {canClaim ? (
          <Button
            size="sm"
            disabled={claiming}
            onClick={() => doClaim({ ticketId: row.ticketId })}
          >
            {claiming ? 'Claiming…' : 'Take this'}
          </Button>
        ) : null}
        {canResolve ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={resolving}
            onClick={() => doResolve({ ticketId: row.ticketId })}
          >
            {resolving ? 'Resolving…' : 'Resolve'}
          </Button>
        ) : null}
      </div>
    </AnimatedLi>
  );
}

function Pagination({
  page,
  pageSize,
  totalCount,
  onGoto,
}: {
  page: number;
  pageSize: number;
  totalCount: number;
  onGoto: (p: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  if (totalPages <= 1) return null;
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalCount);
  return (
    <div className="flex items-center justify-between gap-2 pt-2">
      <Button
        variant="outline"
        size="sm"
        onClick={() => onGoto(page - 1)}
        disabled={page <= 1}
      >
        <Icon name="chevron_left" size="xs" />
        Previous
      </Button>
      <span className="text-xs text-muted-foreground">
        {start}–{end} of {totalCount} · page {page} of {totalPages}
      </span>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onGoto(page + 1)}
        disabled={page >= totalPages}
      >
        Next
        <Icon name="chevron_right" size="xs" />
      </Button>
    </div>
  );
}
