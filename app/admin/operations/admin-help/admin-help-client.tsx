'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  replyAdminHelpAction,
  type AdminHelpInboxRow,
} from '@/lib/admin-help/actions';

interface Props {
  messages: AdminHelpInboxRow[];
}

export function AdminHelpInboxClient({ messages }: Props) {
  const router = useRouter();
  const [replying, setReplying] = useState<{
    msg: AdminHelpInboxRow;
    text: string;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [isPending, startTransition] = useTransition();
  const busy = submitting || isPending;

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

  const pending = messages.filter((m) => m.repliedAt === null);
  const done = messages.filter((m) => m.repliedAt !== null);

  if (messages.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed bg-card/50 p-12 text-center">
        <Icon
          name="forum"
          size="lg"
          className="text-muted-foreground/50 mx-auto mb-3"
          aria-hidden
        />
        <p className="text-sm text-muted-foreground">
          No admin help messages yet. Sales execs can send one from the
          request detail page.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {pending.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-700">
            Pending reply ({pending.length})
          </h2>
          <ul className="space-y-2">
            {pending.map((m) => (
              <MessageCard
                key={m.id}
                message={m}
                onReply={() => setReplying({ msg: m, text: '' })}
                busy={busy}
              />
            ))}
          </ul>
        </section>
      )}

      {done.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Replied ({done.length})
          </h2>
          <ul className="space-y-2">
            {done.map((m) => (
              <MessageCard
                key={m.id}
                message={m}
                onReply={null}
                busy={busy}
              />
            ))}
          </ul>
        </section>
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
                <p className="text-sm whitespace-pre-line">{replying.msg.message}</p>
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
                  {(replying.text.length)} / 500 — minimum 10 chars
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

function MessageCard({
  message,
  onReply,
  busy,
}: {
  message: AdminHelpInboxRow;
  onReply: (() => void) | null;
  busy: boolean;
}) {
  return (
    <li className="rounded-2xl border bg-card p-4 shadow-sm space-y-2">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-semibold tracking-tight">
            {message.execName ?? '(unknown exec)'}
          </p>
          <p className="text-[11px] text-muted-foreground">
            on{' '}
            <Link
              href={`/admin/requests/${message.requestId}`}
              className="text-primary hover:underline"
            >
              {message.customerName}
            </Link>
            {' · '}
            {formatDistanceToNow(message.sentAt, { addSuffix: true })}
          </p>
        </div>
        {message.repliedAt === null ? (
          <Badge variant="outline" className="text-[10px] text-amber-700">
            Pending
          </Badge>
        ) : (
          <Badge variant="outline" className="text-[10px] text-emerald-700">
            Replied
          </Badge>
        )}
      </div>
      <p className="text-sm whitespace-pre-line text-foreground/90">
        {message.message}
      </p>
      {message.repliedAt && message.repliedMessage && (
        <div className="mt-2 rounded-lg border-l-2 border-l-primary/50 bg-muted/40 px-3 py-2 space-y-0.5">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Admin replied{' '}
            {formatDistanceToNow(message.repliedAt, { addSuffix: true })}
          </p>
          <p className="text-sm whitespace-pre-line">{message.repliedMessage}</p>
        </div>
      )}
      {onReply && (
        <div className="flex justify-end pt-1">
          <Button
            type="button"
            size="sm"
            onClick={onReply}
            disabled={busy}
          >
            <Icon name="reply" size="xs" />
            Reply
          </Button>
        </div>
      )}
    </li>
  );
}
