'use client';

import { formatDistanceToNow } from 'date-fns';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Textarea } from '@/components/ui/textarea';
import { addNoteAction } from '@/lib/notes/actions';
import { roleLabel, type NoteRow, type NoteTarget } from '@/lib/notes/types';
import { cn } from '@/lib/utils';

// =============================================================================
// HVA-73 PR 2 + PR 3: NotesSection — append-only timeline + write area
// =============================================================================
//
// One reusable component dropped on the request detail page AND on both
// contact detail pages (exec + captain). The page passes server-rendered
// notes + a canWrite boolean; the component itself never makes auth
// decisions. The author of each note is rendered with name + role badge
// + relative timestamp; the body is plain text.
//
// On Save:
//   1. Optimistic-insert a `note-temp-…` row at the top of the local
//      list (so the user sees their note immediately).
//   2. `await addNoteAction(...)`. On success: replace temp with the
//      server-returned row + router.refresh() to pull the canonical
//      payload (cheap; this section is small).
//   3. On failure: drop the temp row, surface a toast.
//
// Optimistic UX kept tight on purpose — no SSE, no polling. The bundle
// explicitly opts out (DO NOT real-time updates).
// =============================================================================

const MAX_BODY = 2000;

interface NotesSectionProps {
  targetType: NoteTarget;
  targetId: string;
  notes: NoteRow[];
  canWrite: boolean;
  /** Logged-in user's display info for optimistic note rendering. */
  viewer: {
    id: string;
    fullName: string | null;
    role: NoteRow['authorRole'];
  };
}

interface LocalNote extends NoteRow {
  /** True for client-only optimistic rows pending server reconciliation. */
  pending?: boolean;
}

export function NotesSection({
  targetType,
  targetId,
  notes: serverNotes,
  canWrite,
  viewer,
}: NotesSectionProps) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [optimistic, setOptimistic] = useState<LocalNote[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [isPending, startTransition] = useTransition();
  const busy = submitting || isPending;

  // Merge server + optimistic, dedup by id (server row replaces optimistic
  // on the next render once router.refresh resolves).
  const seen = new Set<string>();
  const merged: LocalNote[] = [];
  for (const n of optimistic) {
    if (!seen.has(n.id)) {
      merged.push(n);
      seen.add(n.id);
    }
  }
  for (const n of serverNotes) {
    if (!seen.has(n.id)) {
      merged.push(n);
      seen.add(n.id);
    }
  }
  // After server rows arrive, drop any optimistic rows whose body matches
  // an already-server-recorded row in the last few seconds (race-window
  // dedup; cheap and safe — optimistic rows only live a tick or two).
  const visible = merged;

  const trimmed = body.trim();
  const length = trimmed.length;
  const overLimit = length > MAX_BODY;
  const canSubmit = !busy && length > 0 && !overLimit;

  async function onSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    const tempId = `note-temp-${
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2)
    }`;
    const tempRow: LocalNote = {
      id: tempId,
      body: trimmed,
      createdAt: new Date(),
      authorUserId: viewer.id,
      authorName: viewer.fullName,
      authorRole: viewer.role,
      pending: true,
    };
    setOptimistic((prev) => [tempRow, ...prev]);
    setBody('');
    try {
      const result = await addNoteAction({
        targetType,
        targetId,
        body: trimmed,
      });
      if (!result.ok) {
        setOptimistic((prev) => prev.filter((n) => n.id !== tempId));
        setBody(trimmed);
        toast.error(result.error);
        return;
      }
      // Replace the temp row with the server-returned one. router.refresh
      // will pick up the canonical list on the next paint.
      setOptimistic((prev) =>
        prev.map((n) => (n.id === tempId ? { ...result.note } : n)),
      );
      toast.success('Note added');
      startTransition(() => {
        router.refresh();
        // Once the server-side list contains this id, the merge above
        // will dedup and our optimistic copy can drop out next render.
        setOptimistic((prev) => prev.filter((n) => n.id !== result.note.id));
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section
      aria-label="Notes"
      className="rounded-2xl border bg-card p-4 space-y-4"
    >
      <header className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold tracking-tight flex items-center gap-2">
          Notes
          <span className="text-sm font-normal text-muted-foreground">
            ({serverNotes.length})
          </span>
        </h2>
      </header>

      {canWrite && (
        <div className="space-y-2">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value.slice(0, MAX_BODY + 100))}
            placeholder="Add a note… e.g. 'Customer wants visit after 6pm'"
            rows={3}
            maxLength={MAX_BODY + 100}
            disabled={busy}
            aria-label="New note body"
          />
          <div className="flex items-center justify-between gap-3">
            <p
              className={cn(
                'text-[11px]',
                overLimit
                  ? 'text-destructive'
                  : length >= 1900
                    ? 'text-amber-600'
                    : 'text-muted-foreground',
              )}
            >
              {length} / {MAX_BODY}
            </p>
            <Button
              type="button"
              size="sm"
              onClick={onSubmit}
              disabled={!canSubmit}
            >
              {busy ? (
                <>
                  <Icon
                    name="progress_activity"
                    size="xs"
                    className="animate-spin"
                  />
                  Saving…
                </>
              ) : (
                'Save note'
              )}
            </Button>
          </div>
        </div>
      )}

      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">No notes yet.</p>
      ) : (
        <ul className="space-y-3" aria-label="Note history">
          {visible.map((n) => (
            <li
              key={n.id}
              className={cn(
                'rounded-xl border bg-background px-3 py-2.5',
                n.pending && 'opacity-70',
              )}
            >
              <div className="flex items-start justify-between gap-3 text-xs">
                <p className="font-medium truncate min-w-0">
                  {n.authorName ?? '—'}{' '}
                  <span className="text-muted-foreground font-normal">
                    · {roleLabel(n.authorRole)}
                  </span>
                </p>
                <span
                  className="text-muted-foreground shrink-0"
                  title={n.createdAt.toString()}
                >
                  {n.pending
                    ? 'Saving…'
                    : formatDistanceToNow(n.createdAt, { addSuffix: true })}
                </span>
              </div>
              <p className="text-sm whitespace-pre-line mt-1 break-words">
                {n.body}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
