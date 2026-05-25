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
  AnnouncementAudience,
  AnnouncementCategoryRow,
  AnnouncementImportance,
  AnnouncementRow,
} from '@/lib/content/types';

// =============================================================================
// HVA-156-FIX2: AnnouncementsClient — admin list + create modal
// =============================================================================
//
// Append-only model per HVA-120 — once posted, the only mutation is
// unpublish / republish. Importance + audience + publishDate + category
// are all set at creation time.
// =============================================================================

const IMPORTANCE_LABELS: Record<AnnouncementImportance, string> = {
  info: 'Info',
  important: 'Important',
  urgent: 'Urgent',
};

const importanceBadgeClass: Record<AnnouncementImportance, string> = {
  info: 'border-blue-500/40 text-blue-700 dark:text-blue-300',
  important: 'border-amber-500/50 text-amber-700 dark:text-amber-300',
  urgent: 'border-destructive/60 text-destructive',
};

const AUDIENCE_LABELS: Record<AnnouncementAudience, string> = {
  sales_executive: 'Sales execs only',
  captain: 'Captains only',
  both: 'Both (broadcast to all)',
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

interface FormState {
  categoryId: string;
  importance: AnnouncementImportance;
  audience: AnnouncementAudience;
  publishDate: string;
  title: string;
  body: string;
}

function emptyForm(defaultCategoryId: string): FormState {
  return {
    categoryId: defaultCategoryId,
    importance: 'info',
    audience: 'both',
    publishDate: todayIso(),
    title: '',
    body: '',
  };
}

export function AnnouncementsClient({
  announcements,
  categories,
}: {
  announcements: AnnouncementRow[];
  categories: AnnouncementCategoryRow[];
}) {
  const router = useRouter();
  const activeCategories = categories.filter((c) => c.isActive);
  const defaultCategoryId = activeCategories[0]?.id ?? categories[0]?.id ?? '';

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<FormState>(() =>
    emptyForm(defaultCategoryId),
  );
  const [submitting, setSubmitting] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const busy = submitting || isPending;

  function openCreate() {
    setForm(emptyForm(defaultCategoryId));
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
    if (!form.categoryId) {
      toast.error('Pick a category');
      return;
    }
    setSubmitting(true);
    try {
      const result = await createAnnouncementAction({
        categoryId: form.categoryId,
        importance: form.importance,
        audience: form.audience,
        publishDate: form.publishDate,
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

  const noActiveCategories = activeCategories.length === 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {announcements.length} announcement
          {announcements.length === 1 ? '' : 's'}
        </p>
        <Button
          type="button"
          onClick={openCreate}
          disabled={noActiveCategories}
          title={
            noActiveCategories
              ? 'Add an announcement category first'
              : undefined
          }
        >
          <Icon name="add" size="sm" />
          New announcement
        </Button>
      </div>

      {noActiveCategories && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          No active announcement categories yet — go to{' '}
          <a
            href="/admin/settings/audit-content/announcement-categories"
            className="font-semibold underline"
          >
            Announcement Categories
          </a>{' '}
          and add one before posting.
        </p>
      )}

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
          {announcements.map((a) => {
            const ackPct =
              a.ackTotal && a.ackTotal > 0
                ? Math.round(((a.ackCount ?? 0) / a.ackTotal) * 100)
                : null;
            return (
              <li
                key={a.id}
                className="rounded-2xl border bg-card p-4 shadow-sm flex items-start gap-3"
              >
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge
                      variant="outline"
                      className={`text-[10px] uppercase tracking-wide ${importanceBadgeClass[a.importance]}`}
                    >
                      {IMPORTANCE_LABELS[a.importance]}
                    </Badge>
                    <Badge
                      variant="secondary"
                      className="text-[10px] uppercase tracking-wide"
                    >
                      {a.categoryName}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      {AUDIENCE_LABELS[a.audience]}
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
                    {a.authorName ?? '—'} · publish{' '}
                    {a.publishDate.toLocaleDateString('en-IN', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                    })}
                    {a.ackTotal !== null && a.ackTotal > 0 && (
                      <>
                        {' '}
                        · {a.ackCount}/{a.ackTotal} acknowledged
                        {ackPct !== null && ` (${ackPct}%)`}
                      </>
                    )}
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
            );
          })}
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="ann-category">
                  Category <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={form.categoryId}
                  onValueChange={(v) =>
                    setForm((s) => ({ ...s, categoryId: v }))
                  }
                  disabled={busy}
                >
                  <SelectTrigger id="ann-category" className="h-11">
                    <SelectValue placeholder="Pick a category" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => (
                      <SelectItem
                        key={c.id}
                        value={c.id}
                        disabled={!c.isActive}
                      >
                        {c.name}
                        {!c.isActive && (
                          <span className="ml-2 text-[10px] uppercase text-muted-foreground">
                            inactive
                          </span>
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ann-importance">
                  Importance <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={form.importance}
                  onValueChange={(v) =>
                    setForm((s) => ({
                      ...s,
                      importance: v as AnnouncementImportance,
                    }))
                  }
                  disabled={busy}
                >
                  <SelectTrigger id="ann-importance" className="h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(['info', 'important', 'urgent'] as AnnouncementImportance[]).map((s) => (
                      <SelectItem key={s} value={s}>
                        {IMPORTANCE_LABELS[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ann-audience">
                  Audience <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={form.audience}
                  onValueChange={(v) =>
                    setForm((s) => ({
                      ...s,
                      audience: v as AnnouncementAudience,
                    }))
                  }
                  disabled={busy}
                >
                  <SelectTrigger id="ann-audience" className="h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(['both', 'sales_executive', 'captain'] as AnnouncementAudience[]).map((a) => (
                      <SelectItem key={a} value={a}>
                        {AUDIENCE_LABELS[a]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ann-publish-date">
                  Publish date <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="ann-publish-date"
                  type="date"
                  value={form.publishDate}
                  onChange={(e) =>
                    setForm((s) => ({ ...s, publishDate: e.target.value }))
                  }
                  disabled={busy}
                  className="h-11"
                />
                <p className="text-[11px] text-muted-foreground">
                  Future dates hide the row until the date arrives.
                </p>
              </div>
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
