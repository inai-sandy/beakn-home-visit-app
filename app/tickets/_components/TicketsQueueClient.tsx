'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { useServerMutation } from '@/lib/hooks/use-server-mutation';
import type { QueueRow } from '@/lib/support-tickets/queue-queries';
import { cn } from '@/lib/utils';

import {
  claimTicketAction,
  resolveTicketAction,
} from '../_actions/transitions';

// =============================================================================
// HVA-255 (HVA-232 Phase 2): /tickets queue UI
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

const CATEGORY_LABEL: Record<string, string> = {
  complaint: 'Complaint',
  warranty: 'Warranty',
  refund: 'Refund',
  other: 'Other',
};

interface Props {
  rows: QueueRow[];
  status: 'open' | 'in_progress' | 'resolved' | 'all';
  category: 'complaint' | 'warranty' | 'refund' | 'other' | 'all';
  mineOnly: boolean;
  search: string;
  page: number;
  pageSize: number;
  totalCount: number;
  currentRole: 'sales_executive' | 'captain' | 'super_admin';
}

const STATUS_TABS: Array<{ value: Props['status']; label: string }> = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'all', label: 'All' },
];

const CATEGORY_OPTIONS: Array<{ value: Props['category']; label: string }> = [
  { value: 'all', label: 'All categories' },
  { value: 'complaint', label: 'Complaint' },
  { value: 'warranty', label: 'Warranty' },
  { value: 'refund', label: 'Refund' },
  { value: 'other', label: 'Other' },
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
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  // eslint-disable-next-line no-restricted-syntax -- URL push
  const [, startTransition] = useTransition();

  const [searchInput, setSearchInput] = useState(search);

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
    <div className="space-y-4">
      {/* Status tabs */}
      <div className="flex flex-wrap items-center gap-2">
        {STATUS_TABS.map((t) => (
          <Button
            key={t.value}
            variant={status === t.value ? 'default' : 'outline'}
            size="sm"
            onClick={() => pushParam('status', t.value === 'open' ? null : t.value)}
          >
            {t.label}
          </Button>
        ))}
        <div className="flex-1" />
        <Button
          variant={mineOnly ? 'default' : 'outline'}
          size="sm"
          onClick={() => pushParam('mine', mineOnly ? null : '1')}
        >
          <Icon name="person" size="xs" />
          My tickets
        </Button>
      </div>

      {/* Search + category */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          placeholder="Search customer name, phone, or subject"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="h-9 flex-1 min-w-[200px]"
        />
        <select
          className="h-9 rounded-md border bg-background px-3 text-sm"
          value={category}
          onChange={(e) =>
            pushParam('category', e.target.value === 'all' ? null : e.target.value)
          }
        >
          {CATEGORY_OPTIONS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      {/* Rows */}
      {rows.length === 0 ? (
        <div className="rounded-3xl border bg-muted/40 p-10 text-center">
          <p className="text-sm text-muted-foreground">No tickets match.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <TicketRow key={r.ticketId} row={r} currentRole={currentRole} />
          ))}
        </ul>
      )}

      {/* Pagination */}
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
}: {
  row: QueueRow;
  currentRole: 'sales_executive' | 'captain' | 'super_admin';
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
    <li className="rounded-3xl border bg-card p-5 shadow-sm space-y-3">
      <div className="flex items-start gap-2 flex-wrap">
        <Badge variant="outline" className={cn('text-[10px]', status.cls)}>
          {status.label}
        </Badge>
        <Badge variant="outline" className="text-[10px]">
          {CATEGORY_LABEL[row.category]}
        </Badge>
        <h3 className="text-base font-semibold tracking-tight flex-1 min-w-0">
          {row.subject}
        </h3>
      </div>

      <div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
        <div>
          <span className="font-medium text-foreground/70">Customer</span>{' '}
          {row.customerName} · {row.customerPhone}
        </div>
        <div>
          <span className="font-medium text-foreground/70">City</span>{' '}
          {row.cityName}
        </div>
        <div>
          <span className="font-medium text-foreground/70">Raised</span>{' '}
          {relativeTime(opened)}
        </div>
        {row.claimedByName ? (
          <div>
            <span className="font-medium text-foreground/70">Owner</span>{' '}
            {row.claimedByName}
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1">
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
    </li>
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
  if (totalPages <= 1) {
    return (
      <p className="text-xs text-muted-foreground">
        {totalCount} {totalCount === 1 ? 'ticket' : 'tickets'}
      </p>
    );
  }
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalCount);
  return (
    <div className="flex items-center justify-between gap-2">
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
