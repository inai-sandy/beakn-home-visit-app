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

import { deactivateExecAction } from '@/lib/warnings/actions';
import { HARD_WARNING_FIRE_THRESHOLD } from '@/lib/warnings/metrics';

// =============================================================================
// HVA-228: FireExecBanner — appears at 5/5 hard warnings
// =============================================================================
//
// Rendered only on the admin exec-detail page. Big red banner with a
// "Deactivate user" button that opens a confirmation dialog requiring
// a freeform reason (10-500 chars). Action is super_admin-gated and
// double-checks the hard count server-side.
// =============================================================================

interface Props {
  execUserId: string;
  execName: string;
  hardActive: number;
}

export function FireExecBanner({
  execUserId,
  execName,
  hardActive,
}: Props) {
  const [open, setOpen] = useState(false);

  if (hardActive < HARD_WARNING_FIRE_THRESHOLD) return null;

  return (
    <>
      <section
        role="alert"
        className="rounded-2xl border-2 border-rose-500 bg-rose-50 dark:bg-rose-950/30 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-3"
      >
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <span className="grid place-items-center w-10 h-10 rounded-full bg-rose-600 text-white shrink-0">
            <Icon name="gpp_bad" size="sm" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold tracking-tight text-rose-900 dark:text-rose-100">
              {execName} has reached {hardActive}/{HARD_WARNING_FIRE_THRESHOLD} hard warnings — eligible for termination
            </p>
            <p className="text-[12px] text-rose-700 dark:text-rose-300 mt-0.5">
              Review the warning history before acting. Deactivation
              prevents login but does not delete the account.
            </p>
          </div>
        </div>
        <Button
          onClick={() => setOpen(true)}
          className="bg-rose-600 hover:bg-rose-700 text-white border-rose-700 w-fit"
        >
          <Icon name="block" size="xs" />
          Deactivate user
        </Button>
      </section>

      {open && (
        <DeactivateDialog
          execUserId={execUserId}
          execName={execName}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function DeactivateDialog({
  execUserId,
  execName,
  onClose,
}: {
  execUserId: string;
  execName: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState('');
  const isValid = reason.trim().length >= 10;

  function submit() {
    if (!isValid) return;
    startTransition(async () => {
      const result = await deactivateExecAction({
        execUserId,
        reason: reason.trim(),
      });
      if (result.ok) {
        toast.success(`${execName} deactivated`);
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
          <DialogTitle className="text-rose-700">
            Deactivate {execName}?
          </DialogTitle>
          <DialogDescription>
            They will no longer be able to log in. Their data stays on
            file — this is reversible by setting <code>is_active = true</code>{' '}
            in the users table.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="deactivate-reason">
            Reason{' '}
            <span className="text-muted-foreground text-[10px]">
              (10–500 chars, required — recorded in audit log)
            </span>
          </Label>
          <Textarea
            id="deactivate-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder="e.g. Five hard warnings issued across Apr–Jun; performance never recovered despite repeated escalations."
            className="resize-none"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={!isValid || pending}
            className="bg-rose-600 hover:bg-rose-700 text-white border-rose-700"
          >
            {pending ? 'Deactivating…' : `Yes, deactivate ${execName}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
