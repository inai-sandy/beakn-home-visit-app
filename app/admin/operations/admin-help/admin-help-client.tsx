'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  replyAdminHelpAction,
  type AdminHelpDateFilter,
  type AdminHelpInboxRow,
} from '@/lib/admin-help/actions';
import type { PageRange } from '@/lib/pagination';
import { cn } from '@/lib/utils';

interface Props {
  messages: AdminHelpInboxRow[];
  total: number;
  pageRange: PageRange;
  currentSearch: string;
  currentDateFilter: AdminHelpDateFilter;
}

const DATE_CHIPS: Array<{ key: AdminHelpDateFilter; label: string }> = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
  { key: 'all', label: 'All time' },
];

export function AdminHelpInboxClient({
  messages,
  total,
  pageRange,
  currentSearch,
  currentDateFilter,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [searchInput, setSearchInput] = useState(currentSearch);
  const [replying, setReplying] = useState<{
    msg: AdminHelpInboxRow;
    text: string;
  } | null>(null);
  // 2026-05-26 universal-closed rule: every accordion / fold-unfold UI
  // defaults to closed. User opens what they need.
  const [openIds, setOpenIds] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  // eslint-disable-next-line no-restricted-syntax -- HVA-149: mixed nav+mutation; HVA-149-cleanup TODO
  const [isPending, startTransition] = useTransition();
  const busy = submitting || isPending;

  // Debounced search → URL ?q=
  useEffect(() => {
    const term = searchInput.trim();
    if (term === currentSearch) return;
    const handle = setTimeout(() => {
      const next = new URLSearchParams(searchParams?.toString() ?? '');
      if (term.length > 0) next.set('q', term);
      else next.delete('q');
      next.delete('page');
      startTransition(() =>
        router.push(`/admin/operations/admin-help?${next.toString()}`),
      );
    }, 300);
    return () => clearTimeout(handle);
  }, [searchInput, currentSearch, router, searchParams]);

  function setDateFilter(key: AdminHelpDateFilter) {
    const next = new URLSearchParams(searchParams?.toString() ?? '');
    if (key === 'all') next.delete('dt');
    else next.set('dt', key);
    next.delete('page');
    startTransition(() =>
      router.push(`/admin/operations/admin-help?${next.toString()}`),
    );
  }

  function goToPage(page: number) {
    const next = new URLSearchParams(searchParams?.toString() ?? '');
    if (page === 1) next.delete('page');
    else next.set('page', String(page));
    startTransition(() =>
      router.push(`/admin/operations/admin-help?${next.toString()}`),
    );
  }

  function toggleOpen(id: string) {
    setOpenIds((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  async function onReply() {
    if (!replying || busy) return;
    if (replying.text.trim().length < 10) {
      toast.error('Reply must be at least 10 characters');
      return;
    }
    setSubmitting(true);
    try {
      const res = await replyAdminHelpAction({
        messageId: replying.msg.id,
        reply: replying.text.trim(),
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success('Reply sent');
      setReplying(null);
      startTransition(() => router.refresh());
    } finally {
      setSubmitting(false);
    }
  }

  const filterBar = (
    <div className="space-y-3">
      <div className="relative">
        <Icon
          name="search"
          size="sm"
          className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search message text, exec name, or customer name"
          className="h-11 pl-9"
          aria-label="Search admin help inbox"
        />
      </div>
      <div className="flex flex-wrap gap-1.5" aria-label="Date filter">
        {DATE_CHIPS.map((chip) => {
          const active = currentDateFilter === chip.key;
          return (
            <button
              key={chip.key}
              type="button"
              onClick={() => setDateFilter(chip.key)}
              disabled={isPending}
              className={cn(
                'inline-flex items-center rounded-full border px-3 py-0.5 text-[11px] tracking-wide transition-colors',
                active
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-card hover:bg-muted border-border text-foreground/80',
              )}
              aria-pressed={active}
            >
              {chip.label}
            </button>
          );
        })}
      </div>
    </div>
  );

  if (total === 0 && currentSearch.length === 0 && currentDateFilter === 'all') {
    return (
      <div className="space-y-4">
        {filterBar}
        <div className="rounded-2xl border border-dashed bg-card/50 p-12 text-center">
          <Icon
            name="forum"
            size="lg"
            className="text-muted-foreground/50 mx-auto mb-3"
            aria-hidden
          />
          <p className="text-sm text-muted-foreground">
            No admin help messages yet.
          </p>
        </div>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="space-y-4">
        {filterBar}
        <div className="rounded-2xl border border-dashed bg-card/50 p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No messages match the current search + filter.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {filterBar}
      <p className="text-[11px] text-muted-foreground">
        Showing {pageRange.from}–{pageRange.to} of {total} message
        {total === 1 ? '' : 's'}
      </p>

      <ul className="space-y-2">
        {messages.map((m) => {
          const isOpen = openIds[m.id] ?? false;
          const isPendingReply = m.repliedAt === null;
          return (
            <li
              key={m.id}
              className={cn(
                'rounded-2xl border bg-card shadow-sm overflow-hidden',
                isPendingReply ? 'border-amber-400/40' : '',
              )}
            >
              <button
                type="button"
                onClick={() => toggleOpen(m.id)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 text-left"
                aria-expanded={isOpen}
              >
                <div className="flex-1 min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold tracking-tight truncate">
                      {m.execName ?? '(unknown exec)'}
                    </p>
                    <span className="text-[11px] text-muted-foreground">
                      on{' '}
                      <Link
                        href={`/requests/${m.requestId}`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-primary hover:underline"
                      >
                        {m.customerName}
                      </Link>
                    </span>
                    {isPendingReply ? (
                      <Badge
                        variant="outline"
                        className="text-[10px] text-amber-700"
                      >
                        Pending
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="text-[10px] text-emerald-700"
                      >
                        Replied
                      </Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {formatDistanceToNow(m.sentAt, { addSuffix: true })}
                  </p>
                  {!isOpen && (
                    <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                      {m.message}
                    </p>
                  )}
                </div>
                <Icon
                  name="expand_more"
                  size="sm"
                  className={cn(
                    'text-muted-foreground transition-transform',
                    isOpen ? 'rotate-180' : '',
                  )}
                />
              </button>

              {isOpen && (
                <div className="px-4 pb-4 space-y-2">
                  <p className="text-sm whitespace-pre-line text-foreground/90">
                    {m.message}
                  </p>
                  {m.repliedAt && m.repliedMessage && (
                    <div className="rounded-lg border-l-2 border-l-primary/50 bg-muted/40 px-3 py-2 space-y-0.5">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        Admin replied{' '}
                        {formatDistanceToNow(m.repliedAt, { addSuffix: true })}
                      </p>
                      <p className="text-sm whitespace-pre-line">
                        {m.repliedMessage}
                      </p>
                    </div>
                  )}
                  {isPendingReply && (
                    <div className="flex justify-end pt-1">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => setReplying({ msg: m, text: '' })}
                        disabled={busy}
                      >
                        <Icon name="reply" size="xs" />
                        Reply
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {pageRange.totalPages > 1 && (
        <nav
          className="flex items-center justify-between gap-2 pt-2"
          aria-label="Pagination"
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => goToPage(pageRange.page - 1)}
            disabled={pageRange.page <= 1 || isPending}
          >
            <Icon name="chevron_left" size="xs" />
            Previous
          </Button>
          <p className="text-[11px] text-muted-foreground tabular-nums">
            Page {pageRange.page} of {pageRange.totalPages}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => goToPage(pageRange.page + 1)}
            disabled={pageRange.page >= pageRange.totalPages || isPending}
          >
            Next
            <Icon name="chevron_right" size="xs" />
          </Button>
        </nav>
      )}

      <Dialog
        open={replying !== null}
        onOpenChange={(o) => !busy && !o && setReplying(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reply</DialogTitle>
            <DialogDescription>
              Sales exec sees this reply on the request detail page. There's
              no thread — reply once.
            </DialogDescription>
          </DialogHeader>
          {replying && (
            <div className="space-y-4">
              <div className="rounded-lg border bg-card/50 p-3">
                <p className="text-[11px] text-muted-foreground mb-1">
                  {replying.msg.execName ?? '(unknown exec)'} ·{' '}
                  {replying.msg.customerName}
                </p>
                <p className="text-sm whitespace-pre-line">
                  {replying.msg.message}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reply-text">
                  Your reply <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  id="reply-text"
                  value={replying.text}
                  onChange={(e) =>
                    setReplying((s) =>
                      s ? { ...s, text: e.target.value.slice(0, 500) } : s,
                    )
                  }
                  maxLength={500}
                  rows={5}
                  disabled={busy}
                />
                <p className="text-[11px] text-muted-foreground">
                  {replying.text.length} / 500 — minimum 10 chars
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setReplying(null)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="button" onClick={onReply} disabled={busy}>
              {busy ? (
                <>
                  <Icon
                    name="progress_activity"
                    size="sm"
                    className="animate-spin"
                  />
                  Sending…
                </>
              ) : (
                'Send reply'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
