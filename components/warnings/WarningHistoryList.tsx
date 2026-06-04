'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
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

import { revokeWarningAction } from '@/lib/warnings/actions';
import type { WarningHistoryRow } from '@/lib/warnings/queries';

// =============================================================================
// HVA-228: WarningHistoryList — chronological list with optional revoke
// =============================================================================
//
// Server component renders the rows server-side and passes them in.
// `canRevoke` controls whether the Revoke button is visible (admin
// only — captain sees same list, no button).
//
// Each row shows: kind badge, metric/period summary, reason snippet,
// issuedBy + when, and (if revoked) a strikethrough + revoke reason.
// Click expand to see the full message_snapshot.
// =============================================================================

interface Props {
  rows: WarningHistoryRow[];
  canRevoke: boolean;
}

function formatDateTime(dt: Date): string {
  return dt.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });
}

export function WarningHistoryList({ rows, canRevoke }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<WarningHistoryRow | null>(
    null,
  );

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">
        No warnings on record.
      </div>
    );
  }

  return (
    <>
      <ul className="space-y-2">
        {rows.map((r) => {
          const isHard = r.kind === 'hard';
          const isRevoked = r.revokedAt !== null;
          const isExpanded = expandedId === r.id;
          return (
            <li
              key={r.id}
              className={`rounded-2xl border p-3 sm:p-4 transition-colors ${
                isRevoked
                  ? 'bg-muted/20 border-muted'
                  : isHard
                    ? 'bg-rose-50/40 border-rose-200 dark:bg-rose-950/10 dark:border-rose-900/30'
                    : 'bg-amber-50/40 border-amber-200 dark:bg-amber-950/10 dark:border-amber-900/30'
              }`}
            >
              <div className="flex items-start gap-3 flex-wrap">
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge
                      variant="outline"
                      className={
                        isHard
                          ? 'border-rose-400 text-rose-700 bg-rose-100/60 dark:bg-rose-950/20'
                          : 'border-amber-400 text-amber-700 bg-amber-100/60 dark:bg-amber-950/20'
                      }
                    >
                      <Icon
                        name={isHard ? 'gpp_bad' : 'campaign'}
                        size="xs"
                      />
                      {isHard ? 'Hard' : 'Soft'}
                    </Badge>
                    {isRevoked && (
                      <Badge
                        variant="outline"
                        className="border-slate-300 text-slate-600 bg-slate-100/60"
                      >
                        <Icon name="undo" size="xs" />
                        Revoked
                      </Badge>
                    )}
                    <span className="text-[11px] text-muted-foreground">
                      {formatDateTime(r.issuedAt)} · by{' '}
                      <span className="font-medium">{r.issuedByName}</span>
                    </span>
                  </div>
                  <p
                    className={`text-sm leading-relaxed ${
                      isRevoked ? 'line-through text-muted-foreground' : ''
                    }`}
                  >
                    <span className="font-medium">{r.metricCode}</span> ·{' '}
                    {r.periodLabel} · current {r.currentValue} / target{' '}
                    {r.targetValue}
                  </p>
                  <p className="text-[12px] text-muted-foreground">
                    <span className="font-medium">Reason:</span> {r.reason}
                  </p>
                  {isRevoked && r.revokedReason && (
                    <p className="text-[11px] text-slate-600">
                      <span className="font-medium">Revoked by</span>{' '}
                      {r.revokedByName ?? '—'}:{' '}
                      <span className="italic">{r.revokedReason}</span>
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-[11px]"
                    onClick={() =>
                      setExpandedId(isExpanded ? null : r.id)
                    }
                  >
                    <Icon
                      name={isExpanded ? 'expand_less' : 'expand_more'}
                      size="xs"
                    />
                    {isExpanded ? 'Hide message' : 'Show message'}
                  </Button>
                  {canRevoke && !isRevoked && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-[11px] border-slate-300 hover:bg-slate-50"
                      onClick={() => setRevokeTarget(r)}
                    >
                      <Icon name="undo" size="xs" />
                      Revoke
                    </Button>
                  )}
                </div>
              </div>
              {isExpanded && (
                <pre className="mt-3 text-[12px] whitespace-pre-wrap leading-relaxed bg-background/60 rounded-lg p-3 border font-sans">
                  {r.messageSnapshot}
                </pre>
              )}
            </li>
          );
        })}
      </ul>

      {revokeTarget && (
        <RevokeDialog
          row={revokeTarget}
          onClose={() => setRevokeTarget(null)}
        />
      )}
    </>
  );
}

function RevokeDialog({
  row,
  onClose,
}: {
  row: WarningHistoryRow;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState('');
  const isValid = reason.trim().length >= 5;

  function submit() {
    if (!isValid) return;
    startTransition(async () => {
      const result = await revokeWarningAction({
        warningId: row.id,
        revokedReason: reason.trim(),
      });
      if (result.ok) {
        toast.success('Warning revoked');
        onClose();
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon name="undo" size="sm" />
            Revoke {row.kind === 'hard' ? 'hard' : 'soft'} warning
          </DialogTitle>
          <DialogDescription>
            Mark this warning as revoked. It stays in the audit history,
            but no longer counts toward the active total.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-lg border bg-muted/30 p-2.5 text-[11px] text-muted-foreground space-y-0.5">
            <p>
              <span className="font-medium">Issued:</span>{' '}
              {row.issuedAt.toLocaleString('en-IN')}
            </p>
            <p>
              <span className="font-medium">Metric:</span> {row.metricCode}
            </p>
            <p>
              <span className="font-medium">Reason:</span> {row.reason}
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="revoke-reason">
              Why are you revoking?{' '}
              <span className="text-muted-foreground text-[10px]">
                (5–500 chars, required)
              </span>
            </Label>
            <Textarea
              id="revoke-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="e.g. Discussed with captain — context was missing context X."
              className="resize-none"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!isValid || pending}>
            {pending ? 'Revoking…' : 'Revoke warning'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
