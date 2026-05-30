'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';

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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { bulkApproveRequestsAction } from '@/lib/captain/bulk-approve';
import { maskCustomerPhone } from '@/lib/format/phone';
import { useServerMutation } from '@/lib/hooks/use-server-mutation';

import { InlineApprovalButtons } from '../inline-approval-buttons';

// Small pagination nav, kept in-file because it's only used here. If
// the approvals list ever splits across multiple paginated lists, lift
// to a shared component.
function ApprovalsPaginationNav({
  pageRange,
}: {
  pageRange: import('@/lib/pagination').PageRange;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // eslint-disable-next-line no-restricted-syntax -- HVA-149: URL push for pagination, not a mutation
  const [, startTransition] = useTransition();

  function go(toPage: number) {
    const next = new URLSearchParams(searchParams?.toString() ?? '');
    if (toPage <= 1) next.delete('page');
    else next.set('page', String(toPage));
    const qs = next.toString();
    startTransition(() =>
      router.push(
        qs.length > 0 ? `/captain/approvals?${qs}` : '/captain/approvals',
      ),
    );
  }

  return (
    <nav
      className="flex items-center justify-between gap-2 pt-2"
      aria-label="Approvals pagination"
    >
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => go(pageRange.page - 1)}
        disabled={pageRange.page <= 1}
      >
        <Icon name="chevron_left" size="xs" />
        Previous
      </Button>
      <p className="text-[11px] text-muted-foreground tabular-nums">
        Page {pageRange.page} of {pageRange.totalPages} · Showing{' '}
        {pageRange.from}–{pageRange.to} of {pageRange.total}
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => go(pageRange.page + 1)}
        disabled={pageRange.page >= pageRange.totalPages}
      >
        Next
        <Icon name="chevron_right" size="xs" />
      </Button>
    </nav>
  );
}

// Lightweight checkbox — avoids adding a new shadcn primitive for one
// usage. Native input styled to match the rest of the form-control
// surface. If checkbox usage spreads, lift to components/ui/checkbox.tsx.
function Checkbox({
  checked,
  onCheckedChange,
  className,
  ...rest
}: {
  checked: boolean;
  onCheckedChange: () => void;
  className?: string;
  'aria-label'?: string;
}) {
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={onCheckedChange}
      className={`h-4 w-4 rounded border-input accent-primary cursor-pointer ${className ?? ''}`}
      {...rest}
    />
  );
}

// =============================================================================
// 2026-05-26: bulk-approve UI for /captain/approvals
// =============================================================================
//
// Wraps the existing per-row card layout with:
//   - a checkbox in each row's header
//   - a sticky footer bar that appears when any row is selected
//   - a "Approve N requests" dialog with an optional shared note
//
// Per-row Approve / Reject buttons (InlineApprovalButtons) stay
// available — the bulk path is additive, not a replacement. Reject is
// intentionally per-row only because each rejection wants its own
// 50-500 char reason that's specific to that exec's work.
//
// Approvals page is still a Server Component; this client island
// receives the pre-loaded row list serialized through `rows`.
// =============================================================================

export interface ApprovalRowDTO {
  id: string;
  customerName: string;
  customerPhone: string;
  cityName: string;
  assignedExecName: string | null;
  execNote: string | null;
  /** ISO string; rehydrated to a Date for formatDistanceToNow. */
  completedAt: string | null;
}

interface Props {
  rows: ApprovalRowDTO[];
  pageRange?: import('@/lib/pagination').PageRange;
}

export function ApprovalsListClient({ rows, pageRange }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [note, setNote] = useState('');

  const { mutate, isPending: bulkBusy } = useServerMutation(
    bulkApproveRequestsAction,
    {
      onSuccess: (data) => {
        const approvedCount = data?.approved.length ?? 0;
        const failureCount = data?.failures.length ?? 0;
        if (approvedCount > 0 && failureCount === 0) {
          toast.success(
            `Approved ${approvedCount} request${approvedCount === 1 ? '' : 's'}.`,
          );
        } else if (approvedCount > 0 && failureCount > 0) {
          toast.warning(
            `Approved ${approvedCount}; ${failureCount} failed (see console for codes).`,
          );
          // eslint-disable-next-line no-console
          console.warn('[bulk-approve] failures:', data?.failures);
        } else if (failureCount > 0) {
          toast.error(
            `${failureCount} request${failureCount === 1 ? '' : 's'} could not be approved.`,
          );
          // eslint-disable-next-line no-console
          console.warn('[bulk-approve] failures:', data?.failures);
        }
        setSelected(new Set());
        setNote('');
        setDialogOpen(false);
      },
    },
  );

  const rowById = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const selectedCount = selected.size;
  const allSelected = rows.length > 0 && selectedCount === rows.length;

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(rows.map((r) => r.id)));
  }

  function openBulkDialog() {
    if (selectedCount === 0) return;
    setDialogOpen(true);
  }

  function onBulkConfirm() {
    if (bulkBusy || selectedCount === 0) return;
    void mutate({
      requestIds: Array.from(selected),
      note: note.trim() || undefined,
    });
  }

  if (rows.length === 0) return null;

  return (
    <>
      <div className="flex items-center justify-between gap-3 rounded-2xl border bg-muted/30 px-4 py-2">
        <label className="inline-flex items-center gap-2 text-xs">
          <Checkbox
            checked={allSelected}
            onCheckedChange={toggleAll}
            aria-label="Select all approvals"
          />
          <span className="text-muted-foreground">
            {selectedCount === 0
              ? 'Select to bulk approve'
              : `${selectedCount} selected`}
          </span>
        </label>
        <Button
          type="button"
          size="sm"
          onClick={openBulkDialog}
          disabled={selectedCount === 0 || bulkBusy}
        >
          <Icon name="task_alt" size="xs" />
          Approve {selectedCount > 0 ? selectedCount : ''}
        </Button>
      </div>

      <ul className="space-y-4">
        {rows.map((r) => {
          const isChecked = selected.has(r.id);
          const completedDate = r.completedAt ? new Date(r.completedAt) : null;
          return (
            <li
              key={r.id}
              className="rounded-3xl border bg-card p-5 shadow-sm space-y-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <Checkbox
                    checked={isChecked}
                    onCheckedChange={() => toggleRow(r.id)}
                    aria-label={`Select ${r.customerName}`}
                    className="mt-1"
                  />
                  <div className="space-y-1 min-w-0">
                    <h2 className="text-base font-semibold tracking-tight">
                      <a href={`/requests/${r.id}`} className="hover:underline">
                        {r.customerName}
                      </a>
                    </h2>
                    <p className="text-xs font-mono text-muted-foreground">
                      {maskCustomerPhone(r.customerPhone)}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="outline" className="text-[10px]">
                    {r.cityName}
                  </Badge>
                </div>
              </div>

              <div className="text-xs text-muted-foreground">
                <span>
                  Exec:{' '}
                  <span className="text-foreground font-medium">
                    {r.assignedExecName ?? '—'}
                  </span>
                </span>
                {completedDate && (
                  <>
                    <span className="mx-2">·</span>
                    <span title={completedDate.toISOString()}>
                      Completed{' '}
                      {formatDistanceToNow(completedDate, { addSuffix: true })}
                    </span>
                  </>
                )}
              </div>

              {r.execNote ? (
                <blockquote className="rounded-2xl border-l-4 border-primary/40 bg-muted/30 px-4 py-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                    Exec&apos;s note
                  </p>
                  <p className="text-sm whitespace-pre-wrap">{r.execNote}</p>
                </blockquote>
              ) : (
                <p className="text-xs text-muted-foreground italic">
                  No note submitted by the exec.
                </p>
              )}

              <div className="flex justify-end pt-1">
                <InlineApprovalButtons
                  requestId={r.id}
                  customerName={r.customerName}
                />
              </div>
            </li>
          );
        })}
      </ul>

      {pageRange && pageRange.totalPages > 1 && (
        <ApprovalsPaginationNav pageRange={pageRange} />
      )}

      <Dialog open={dialogOpen} onOpenChange={(o) => !bulkBusy && setDialogOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Approve {selectedCount} request{selectedCount === 1 ? '' : 's'}?
            </DialogTitle>
            <DialogDescription>
              Each request advances to Order Executed Successfully and the
              assigned exec is notified. An optional note applies to every
              row.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <ul className="max-h-40 overflow-y-auto rounded-lg border bg-muted/30 px-3 py-2 text-xs space-y-0.5">
              {Array.from(selected).map((id) => (
                <li key={id} className="truncate">
                  {rowById.get(id)?.customerName ?? id}
                </li>
              ))}
            </ul>

            <div className="space-y-1">
              <Label htmlFor="bulk-approve-note">
                Note <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Textarea
                id="bulk-approve-note"
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, 500))}
                placeholder="Applied to every approval. Leave blank if no note."
                disabled={bulkBusy}
                maxLength={500}
                rows={3}
              />
              <p className="text-[11px] text-muted-foreground">
                {note.length} / 500
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={bulkBusy}
            >
              Cancel
            </Button>
            <Button type="button" onClick={onBulkConfirm} disabled={bulkBusy}>
              {bulkBusy ? (
                <>
                  <Icon
                    name="progress_activity"
                    size="sm"
                    className="animate-spin"
                  />
                  Approving…
                </>
              ) : (
                `Approve ${selectedCount}`
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
