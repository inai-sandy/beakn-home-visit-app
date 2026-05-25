'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

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
import {
  TRACK_CANCEL_REASON_CODES,
  TRACK_CANCEL_REASON_LABELS,
  type TrackCancelReason,
} from '@/lib/validators/track-cancel';

// =============================================================================
// HVA-39: customer cancellation button + dialog on /track/[token]
// =============================================================================
//
// Renders a discreet "Cancel request" button below the status timeline.
// On tap, opens a dialog that picks one of three customer-facing reasons
// plus an "Other" path that requires a free-text note (10 chars minimum
// — keeps the audit trail informative without being onerous).
// =============================================================================

interface Props {
  token: string;
}

export function CancelRequestButton({ token }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<TrackCancelReason | null>(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [isPending, startTransition] = useTransition();
  const busy = submitting || isPending;

  async function onSubmit() {
    if (busy) return;
    if (!reason) {
      toast.error('Please pick a reason');
      return;
    }
    if (reason === 'OTHER' && note.trim().length < 10) {
      toast.error('When reason is "Other", tell us a bit more (at least 10 characters)');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/track/${encodeURIComponent(token)}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason,
          note: note.trim() || undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        toast.error(data.error ?? 'Could not cancel the request.');
        return;
      }
      toast.success('Request cancelled');
      setOpen(false);
      startTransition(() => router.refresh());
    } catch {
      toast.error('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          setReason(null);
          setNote('');
          setOpen(true);
        }}
        className="h-10"
      >
        <Icon name="cancel" size="sm" />
        Cancel request
      </Button>

      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel your home visit request?</DialogTitle>
            <DialogDescription>
              This closes the request. Our team is notified immediately.
              Cancellation can&apos;t be undone — you can submit a fresh
              request later if you change your mind.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <fieldset className="space-y-2">
              <Label>Reason</Label>
              <div className="flex flex-col gap-1.5">
                {TRACK_CANCEL_REASON_CODES.map((code) => (
                  <label
                    key={code}
                    className="flex items-start gap-2 text-sm cursor-pointer"
                  >
                    <input
                      type="radio"
                      name="cancel-reason"
                      value={code}
                      checked={reason === code}
                      onChange={() => setReason(code)}
                      disabled={busy}
                      className="mt-1"
                    />
                    <span>{TRACK_CANCEL_REASON_LABELS[code]}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="space-y-1.5">
              <Label htmlFor="cancel-note">
                {reason === 'OTHER'
                  ? 'Please tell us why (required)'
                  : 'Anything else you want us to know (optional)'}
              </Label>
              <Textarea
                id="cancel-note"
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, 500))}
                maxLength={500}
                disabled={busy}
                rows={4}
                placeholder={
                  reason === 'OTHER'
                    ? 'A short explanation helps our team learn.'
                    : 'Optional context for our team.'
                }
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Never mind
            </Button>
            <Button
              type="button"
              onClick={onSubmit}
              disabled={busy}
              variant="destructive"
            >
              {busy ? (
                <>
                  <Icon
                    name="progress_activity"
                    size="sm"
                    className="animate-spin"
                  />
                  Cancelling…
                </>
              ) : (
                'Cancel request'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
