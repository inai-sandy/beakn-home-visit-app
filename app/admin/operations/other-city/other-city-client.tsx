'use client';

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  routeOtherCityRequestAction,
  type OtherCityRequestRow,
} from '@/lib/admin/other-city-queue';
import type { PageRange } from '@/lib/pagination';

interface Captain {
  id: string;
  fullName: string;
}

interface Props {
  requests: OtherCityRequestRow[];
  captains: Captain[];
  total: number;
  pageRange: PageRange;
  currentSearch: string;
}

interface ModalState {
  request: OtherCityRequestRow;
  captainId: string;
  reason: string;
}

export function OtherCityQueueClient({
  requests,
  captains,
  total,
  pageRange,
  currentSearch,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [modal, setModal] = useState<ModalState | null>(null);
  const [searchInput, setSearchInput] = useState(currentSearch);
  const [submitting, setSubmitting] = useState(false);
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
      next.delete('page'); // reset to page 1 on new search
      startTransition(() =>
        router.push(`/admin/operations/other-city?${next.toString()}`),
      );
    }, 300);
    return () => clearTimeout(handle);
  }, [searchInput, currentSearch, router, searchParams]);

  function goToPage(page: number) {
    const next = new URLSearchParams(searchParams?.toString() ?? '');
    if (page === 1) next.delete('page');
    else next.set('page', String(page));
    startTransition(() =>
      router.push(`/admin/operations/other-city?${next.toString()}`),
    );
  }

  async function onConfirm() {
    if (!modal || busy) return;
    if (!modal.captainId) {
      toast.error('Pick a captain to route to');
      return;
    }
    setSubmitting(true);
    try {
      const res = await routeOtherCityRequestAction({
        requestId: modal.request.id,
        toCaptainUserId: modal.captainId,
        reason: modal.reason.trim() || undefined,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success('Request routed');
      setModal(null);
      startTransition(() => router.refresh());
    } finally {
      setSubmitting(false);
    }
  }

  const searchBar = (
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
        placeholder="Search by name / phone / state / address"
        className="h-11 pl-9"
        aria-label="Search Other-city queue"
      />
    </div>
  );

  if (total === 0 && currentSearch.length === 0) {
    return (
      <div className="space-y-4">
        {searchBar}
        <div className="rounded-2xl border border-dashed bg-card/50 p-12 text-center">
          <Icon
            name="priority_high"
            size="lg"
            className="text-muted-foreground/50 mx-auto mb-3"
            aria-hidden
          />
          <h2 className="text-base font-semibold tracking-tight">
            No Other-city requests in queue
          </h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
            New requests from cities outside the service area land here. The
            queue is empty right now.
          </p>
        </div>
      </div>
    );
  }

  if (requests.length === 0) {
    return (
      <div className="space-y-4">
        {searchBar}
        <div className="rounded-2xl border border-dashed bg-card/50 p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No Other-city requests match "{currentSearch}".
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {searchBar}
      <p className="text-sm text-muted-foreground">
        Showing {pageRange.from}–{pageRange.to} of {total} pending request
        {total === 1 ? '' : 's'}
      </p>
      <ul className="space-y-3">
        {requests.map((r) => (
          <li
            key={r.id}
            className="rounded-2xl border bg-card p-4 shadow-sm space-y-2"
          >
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <div className="space-y-0.5">
                <p className="text-base font-semibold tracking-tight">
                  {r.customerName}
                </p>
                <p className="text-xs text-muted-foreground">
                  {r.customerPhone}
                  {r.customerEmail ? ` · ${r.customerEmail}` : ''}
                </p>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Submitted{' '}
                {formatDistanceToNow(r.createdAt, { addSuffix: true })}
              </p>
            </div>
            <p className="text-sm text-foreground/80">{r.address}</p>
            <div className="flex items-center gap-2 flex-wrap">
              {r.customerState && (
                <Badge variant="outline" className="text-[10px]">
                  {r.customerState}
                </Badge>
              )}
              <Badge variant="secondary" className="text-[10px]">
                {r.bhk}
              </Badge>
              {r.interest.map((i) => (
                <Badge
                  key={i}
                  variant="outline"
                  className="text-[10px]"
                >
                  {i}
                </Badge>
              ))}
            </div>
            <div className="flex justify-end">
              <Button
                type="button"
                size="sm"
                onClick={() =>
                  setModal({
                    request: r,
                    captainId: captains[0]?.id ?? '',
                    reason: '',
                  })
                }
                disabled={busy || captains.length === 0}
              >
                <Icon name="forward" size="xs" />
                Manually Route
              </Button>
            </div>
          </li>
        ))}
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
        open={modal !== null}
        onOpenChange={(o) => !busy && !o && setModal(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Route to captain</DialogTitle>
            <DialogDescription>
              Picks a captain to handle this Other-city request. The captain
              will see it under their pending approvals and assign to a sales
              exec from there.
            </DialogDescription>
          </DialogHeader>
          {modal && (
            <div className="space-y-4">
              <div className="rounded-lg border bg-card/50 p-3 space-y-0.5">
                <p className="text-sm font-semibold tracking-tight">
                  {modal.request.customerName}
                </p>
                <p className="text-xs text-muted-foreground">
                  {modal.request.address}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="route-captain">
                  Route to <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={modal.captainId}
                  onValueChange={(v) =>
                    setModal((s) => (s ? { ...s, captainId: v } : s))
                  }
                  disabled={busy}
                >
                  <SelectTrigger id="route-captain" className="h-11">
                    <SelectValue placeholder="Pick a captain" />
                  </SelectTrigger>
                  <SelectContent>
                    {captains.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.fullName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="route-reason">
                  Routing note{' '}
                  <span className="text-muted-foreground">(optional)</span>
                </Label>
                <Textarea
                  id="route-reason"
                  value={modal.reason}
                  onChange={(e) =>
                    setModal((s) =>
                      s
                        ? { ...s, reason: e.target.value.slice(0, 500) }
                        : s,
                    )
                  }
                  maxLength={500}
                  rows={3}
                  disabled={busy}
                  placeholder="Why this captain? e.g. 'Closest geography to customer's state.'"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setModal(null)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="button" onClick={onConfirm} disabled={busy}>
              {busy ? (
                <>
                  <Icon
                    name="progress_activity"
                    size="sm"
                    className="animate-spin"
                  />
                  Routing…
                </>
              ) : (
                'Route'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
