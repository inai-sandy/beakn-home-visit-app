'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { addOrderCommentAction } from '@/lib/order-comments/actions';
import type { Role } from '@/lib/auth/roles';
import { useServerMutation } from '@/lib/hooks/use-server-mutation';
import { cn } from '@/lib/utils';

// =============================================================================
// HVA-241 (HVA-231 Phase 3): comments thread + composer
// =============================================================================
//
// Renders parents in chronological order with replies indented under them.
// Composer at the bottom; click "Reply" on any parent to attach the next
// post to its thread. Polls via router.refresh() every 30s when the tab
// is visible (Page Visibility API).
//
// @mention picker: text input + dropdown filtered from the legal pool
// (support + admin + assigned exec + assigned captain). Only the
// mentionedUserIds explicitly chosen via the picker fan out as extra
// notifications.
// =============================================================================

const POLL_INTERVAL_MS = 30_000;

const ROLE_TONE: Record<Role, string> = {
  super_admin: 'bg-violet-500/10 text-violet-700 border-violet-500/30',
  captain: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/30',
  sales_executive: 'bg-sky-500/10 text-sky-700 border-sky-500/30',
  support: 'bg-amber-500/10 text-amber-700 border-amber-500/30',
};

const ROLE_LABEL: Record<Role, string> = {
  super_admin: 'Admin',
  captain: 'Captain',
  sales_executive: 'Exec',
  support: 'Support',
};

export interface OrderCommentDTO {
  id: string;
  body: string;
  parentCommentId: string | null;
  createdAtIso: string;
  authorUserId: string;
  authorName: string | null;
  authorRole: Role;
}

interface Props {
  requestId: string;
  currentUserId: string;
  initialComments: OrderCommentDTO[];
  mentionPool: { id: string; fullName: string | null; role: Role }[];
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return d.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function OrderCommentsClient({
  requestId,
  currentUserId,
  initialComments,
  mentionPool,
}: Props) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [mentionedIds, setMentionedIds] = useState<Set<string>>(new Set());
  const [mentionOpen, setMentionOpen] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  const { mutate, isPending } = useServerMutation(addOrderCommentAction, {
    onSuccess: () => {
      setBody('');
      setReplyTo(null);
      setMentionedIds(new Set());
      setMentionOpen(false);
    },
  });

  // 30s polling refresh, only while tab is visible.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (intervalId !== null) return;
      intervalId = setInterval(() => {
        if (document.visibilityState === 'visible') {
          router.refresh();
        }
      }, POLL_INTERVAL_MS);
    };
    const stop = () => {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };
    if (document.visibilityState === 'visible') start();
    const onVis = () => {
      if (document.visibilityState === 'visible') start();
      else stop();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [router]);

  const { parents, repliesByParent } = useMemo(() => {
    const parents: OrderCommentDTO[] = [];
    const repliesByParent = new Map<string, OrderCommentDTO[]>();
    for (const c of initialComments) {
      if (c.parentCommentId === null) {
        parents.push(c);
      } else {
        const arr = repliesByParent.get(c.parentCommentId) ?? [];
        arr.push(c);
        repliesByParent.set(c.parentCommentId, arr);
      }
    }
    return { parents, repliesByParent };
  }, [initialComments]);

  const visiblePool = useMemo(
    () => mentionPool.filter((m) => m.id !== currentUserId),
    [mentionPool, currentUserId],
  );

  function toggleMention(id: string) {
    setMentionedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit() {
    const trimmed = body.trim();
    if (trimmed.length === 0) return;
    await mutate({
      requestId,
      parentCommentId: replyTo,
      body: trimmed,
      mentionedUserIds: Array.from(mentionedIds),
    });
  }

  function renderComment(c: OrderCommentDTO, isReply: boolean) {
    const authorLabel = c.authorName ?? ROLE_LABEL[c.authorRole];
    return (
      <div
        key={c.id}
        className={cn(
          'rounded-2xl border bg-card p-3 space-y-1',
          isReply && 'ml-8 bg-muted/40',
        )}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium">{authorLabel}</span>
          <Badge
            variant="outline"
            className={cn('text-[10px]', ROLE_TONE[c.authorRole])}
          >
            {ROLE_LABEL[c.authorRole]}
          </Badge>
          <span className="text-[11px] text-muted-foreground">
            {formatWhen(c.createdAtIso)}
          </span>
        </div>
        <p className="text-sm whitespace-pre-wrap break-words">{c.body}</p>
        {!isReply && (
          <div className="pt-1">
            <button
              type="button"
              onClick={() => {
                setReplyTo(c.id);
                composerRef.current?.focus();
              }}
              className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
            >
              Reply
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {parents.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No comments yet. Be the first to leave a note for this order.
        </p>
      ) : (
        <div className="space-y-3">
          {parents.map((p) => (
            <div key={p.id} className="space-y-2">
              {renderComment(p, false)}
              {(repliesByParent.get(p.id) ?? []).map((r) =>
                renderComment(r, true),
              )}
            </div>
          ))}
        </div>
      )}

      <div className="rounded-2xl border bg-card p-3 space-y-2">
        {replyTo && (
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Replying to a comment</span>
            <button
              type="button"
              onClick={() => setReplyTo(null)}
              className="text-xs hover:text-foreground underline-offset-2 hover:underline"
            >
              Cancel reply
            </button>
          </div>
        )}
        <textarea
          ref={composerRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Leave a note for the team…"
          maxLength={2000}
          rows={3}
          className="w-full rounded-xl border bg-background px-3 py-2 text-sm resize-y min-h-[64px] focus:outline-none focus:ring-2 focus:ring-primary/40"
          aria-label="Comment body"
        />
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            {visiblePool.length > 0 && (
              <div className="relative">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setMentionOpen((o) => !o)}
                >
                  <Icon name="alternate_email" size="xs" />
                  <span>Mention ({mentionedIds.size})</span>
                </Button>
                {mentionOpen && (
                  <div className="absolute z-10 mt-1 w-56 rounded-xl border bg-popover shadow p-1 max-h-60 overflow-y-auto">
                    {visiblePool.map((p) => {
                      const checked = mentionedIds.has(p.id);
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => toggleMention(p.id)}
                          className={cn(
                            'flex items-center justify-between w-full rounded-lg px-2 py-1.5 text-sm hover:bg-muted',
                            checked && 'bg-primary/5',
                          )}
                        >
                          <span className="truncate">
                            {p.fullName ?? '(no name)'}
                          </span>
                          <Badge
                            variant="outline"
                            className={cn('ml-2 text-[10px]', ROLE_TONE[p.role])}
                          >
                            {ROLE_LABEL[p.role]}
                          </Badge>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            <span className="text-[11px] text-muted-foreground">
              {body.length}/2000
            </span>
          </div>
          <Button
            size="sm"
            onClick={submit}
            disabled={isPending || body.trim().length === 0}
          >
            {isPending ? 'Posting…' : replyTo ? 'Post reply' : 'Post comment'}
          </Button>
        </div>
      </div>
    </div>
  );
}
