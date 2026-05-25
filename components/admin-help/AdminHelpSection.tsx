'use client';

import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';

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
import { sendAdminHelpAction } from '@/lib/admin-help/actions';
import { useServerMutation } from '@/lib/hooks/use-server-mutation';
import { toast } from 'sonner';

// =============================================================================
// HVA-77: Admin Help — exec sends a per-appointment message; sees thread
// =============================================================================

interface AdminHelpMessageRow {
  id: string;
  message: string;
  sentAt: Date;
  repliedMessage: string | null;
  repliedAt: Date | null;
}

interface Props {
  requestId: string;
  messages: AdminHelpMessageRow[];
}

export function AdminHelpSection({ requestId, messages }: Props) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');

  // HVA-149: useServerMutation bundles useTransition + router.refresh() +
  // toast.error/success so the refresh-required bug class can't recur.
  const { mutate: send, isPending: busy } = useServerMutation(
    sendAdminHelpAction,
    {
      successMessage: 'Message sent to admin',
      onSuccess: () => {
        setText('');
        setOpen(false);
      },
    },
  );

  const pendingCount = messages.filter((m) => m.repliedAt === null).length;

  function onSend() {
    if (busy) return;
    if (text.trim().length < 10) {
      toast.error('Message must be at least 10 characters');
      return;
    }
    void send({ requestId, message: text.trim() });
  }

  return (
    <section
      aria-label="Admin Help"
      className="rounded-3xl border bg-card p-5 shadow-sm space-y-3"
    >
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Admin Help</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Send admin a question about this customer. They reply by email +
            on this page.
          </p>
        </div>
        <Button type="button" size="sm" onClick={() => setOpen(true)}>
          <Icon name="support_agent" size="xs" />
          Send message
        </Button>
      </div>

      {messages.length > 0 && (
        <ul className="space-y-2">
          {messages.map((m) => (
            <li
              key={m.id}
              className="rounded-2xl border bg-muted/30 p-3 space-y-1.5"
            >
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  You · {formatDistanceToNow(m.sentAt, { addSuffix: true })}
                </p>
                {m.repliedAt === null && (
                  <span className="text-[10px] uppercase tracking-wide text-amber-700">
                    Waiting on reply
                  </span>
                )}
              </div>
              <p className="text-sm whitespace-pre-line">{m.message}</p>
              {m.repliedAt && m.repliedMessage && (
                <div className="mt-1 rounded-lg border-l-2 border-l-primary/50 bg-background px-3 py-2 space-y-0.5">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Admin · {formatDistanceToNow(m.repliedAt, { addSuffix: true })}
                  </p>
                  <p className="text-sm whitespace-pre-line">
                    {m.repliedMessage}
                  </p>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Send message to admin</DialogTitle>
            <DialogDescription>
              Admin sees this on the inbox + gets an email immediately. Reply
              comes back here. 10–500 characters.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="admin-help-text">Your question</Label>
            <Textarea
              id="admin-help-text"
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, 500))}
              maxLength={500}
              rows={5}
              disabled={busy}
              placeholder="e.g. Customer wants 20% discount on the lighting package — OK to approve?"
            />
            <p className="text-[11px] text-muted-foreground">
              {text.length} / 500
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="button" onClick={onSend} disabled={busy}>
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
                'Send'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* pendingCount referenced for future badge work */}
      <span className="sr-only">{pendingCount} pending</span>
    </section>
  );
}
