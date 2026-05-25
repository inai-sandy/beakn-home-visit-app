'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
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
  createAnnouncementAction,
  setAnnouncementPublishedAction,
  type CreateAnnouncementInput,
} from '@/lib/content/actions';
import type {
  AnnouncementRow,
  AnnouncementSeverity,
} from '@/lib/content/types';

// =============================================================================
// HVA-156: AnnouncementsClient — admin list + create modal + unpublish
// =============================================================================

const SEVERITY_OPTIONS: AnnouncementSeverity[] = ['info', 'important', 'urgent'];
const SEVERITY_LABELS: Record<AnnouncementSeverity, string> = {
  info: 'Info',
  important: 'Important',
  urgent: 'Urgent',
};

const severityBadgeClass: Record<AnnouncementSeverity, string> = {
  info: 'border-blue-500/40 text-blue-700 dark:text-blue-300',
  important: 'border-amber-500/50 text-amber-700 dark:text-amber-300',
  urgent: 'border-destructive/60 text-destructive',
};

interface FormState {
  severity: AnnouncementSeverity;
  title: string;
  body: string;
}

function emptyForm(): FormState {
  return { severity: 'info', title: '', body: '' };
}

export function AnnouncementsClient({
  announcements,
}: {
  announcements: AnnouncementRow[];
}) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [submitting, setSubmitting] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const busy = submitting || isPending;

  function openCreate() {
    setForm(emptyForm());
    setCreateOpen(true);
  }

  async function onCreate() {
    if (busy) return;
    if (form.title.trim().length < 3) {
      toast.error('Title must be at least 3 characters');
      return;
    }
    if (form.body.trim().length < 1) {
      toast.error('Body cannot be empty');
      return;
    }
    setSubmitting(true);
    try {
      const result = await createAnnouncementAction({
        severity: form.severity,
        title: form.title.trim(),
        body: form.body.trim(),
      } satisfies CreateAnnouncementInput);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success('Announcement posted');
      setCreateOpen(false);
      startTransition(() => router.refresh());
    } finally {
      setSubmitting(false);
    }
  }

  async function togglePublished(row: AnnouncementRow) {
    if (busy || togglingId !== null) return;
    setTogglingId(row.id);
    try {
      const result = await setAnnouncementPublishedAction({
        id: row.id,
        isPublished: !row.isPublished,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(row.isPublished ? 'Unpublished' : 'Republished');
      startTransition(() => router.refresh());
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {announcements.length} announcement
          {announcements.length === 1 ? '' : 's'}
        </p>
        <Button type="button" onClick={openCreate}>
          <Icon name="add" size="sm" />
          New announcement
        </Button>
      </div>

      {announcements.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-card/50 p-12 text-center">
          <Icon
            name="campaign"
            size="lg"
            className="text-muted-foreground/50 mx-auto mb-3"
            aria-hidden
          />
          <p className="text-sm text-muted-foreground">
            No announcements yet. Post the first one to broadcast to the team.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {announcements.map((a) => (
            <li
              key={a.id}
              className="rounded-2xl border bg-card p-4 shadow-sm flex items-start gap-3"
            >
              <div className="flex-1 min-w-0 space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge
                    variant="outline"
                    className={`text-[10px] uppercase tracking-wide ${severityBadgeClass[a.severity]}`}
                  >
                    {SEVERITY_LABELS[a.severity]}
                  </Badge>
                  {!a.isPublished && (
                    <Badge variant="outline" className="text-[10px]">
                      Unpublished
                    </Badge>
                  )}
                </div>
                <p className="text-base font-semibold tracking-tight">
                  {a.title}
                </p>
                <p className="text-xs text-muted-foreground whitespace-pre-line line-clamp-3">
                  {a.body}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {a.authorName ?? '—'} ·{' '}
                  {a.publishedAt.toLocaleDateString('en-IN', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                  })}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => togglePublished(a)}
                disabled={busy || togglingId === a.id}
              >
                {togglingId === a.id ? '…' : a.isPublished ? 'Unpublish' : 'Republish'}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={createOpen} onOpenChange={(o) => !busy && setCreateOpen(o)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>New announcement</DialogTitle>
            <DialogDescription>
              Announcements cannot be edited after posting. Take care with the
              wording.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ann-severity">
                Severity <span className="text-destructive">*</span>
              </Label>
              <Select
                value={form.severity}
                onValueChange={(v) =>
                  setForm((s) => ({
                    ...s,
                    severity: v as AnnouncementSeverity,
                  }))
                }
                disabled={busy}
              >
                <SelectTrigger id="ann-severity" className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEVERITY_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {SEVERITY_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ann-title">
                Title <span className="text-destructive">*</span>
              </Label>
              <Input
                id="ann-title"
                value={form.title}
                onChange={(e) =>
                  setForm((s) => ({ ...s, title: e.target.value.slice(0, 200) }))
                }
                maxLength={200}
                disabled={busy}
                className="h-11"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ann-body">
                Body <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="ann-body"
                value={form.body}
                onChange={(e) =>
                  setForm((s) => ({
                    ...s,
                    body: e.target.value.slice(0, 20_000),
                  }))
                }
                rows={6}
                maxLength={20_000}
                disabled={busy}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCreateOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="button" onClick={onCreate} disabled={busy}>
              {busy ? (
                <>
                  <Icon
                    name="progress_activity"
                    size="sm"
                    className="animate-spin"
                  />
                  Posting…
                </>
              ) : (
                'Post announcement'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
