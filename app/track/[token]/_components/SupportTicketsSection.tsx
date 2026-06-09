'use client';

import { useEffect, useRef, useState } from 'react';
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
import { cn } from '@/lib/utils';
import type { CustomerTicketRow } from '@/lib/support-tickets/queries';

// =============================================================================
// HVA-254 (HVA-232 Phase 1): /track/[token] support tickets section
// =============================================================================
//
// Renders:
//   - "Need help with this order?" outline button below the timeline
//   - On click: dialog with subject + category + description + Turnstile
//   - "Your support requests" list section showing existing tickets with
//     amber/sky/emerald status badges + reopen button on resolved tickets
//
// The Turnstile script is loaded by the parent track page (next/script
// afterInteractive). This component renders the widget container on
// demand when the dialog opens.
// =============================================================================

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '';

// window.turnstile is already declared globally by app/request/request-form.tsx
// (HVA-34). Just use the existing global here.

// HVA-256-FIX1: categories come from the server (admin-managed table);
// no more hardcoded enum here.
interface CategoryOption {
  code: string;
  name: string;
}

const STATUS_STYLE: Record<
  'open' | 'in_progress' | 'resolved',
  { label: string; cls: string }
> = {
  open: {
    label: 'Open',
    cls: 'bg-amber-500/10 text-amber-700 border-amber-500/30',
  },
  in_progress: {
    label: 'In progress',
    cls: 'bg-sky-500/10 text-sky-700 border-sky-500/30',
  },
  resolved: {
    label: 'Resolved',
    cls: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/30',
  },
};

function relativeTime(when: Date): string {
  const diffMs = Date.now() - when.getTime();
  const m = Math.floor(diffMs / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min${m === 1 ? '' : 's'} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr${h === 1 ? '' : 's'} ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`;
  return when.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
  });
}

interface Props {
  trackingToken: string;
  initialTickets: CustomerTicketRow[];
  // HVA-256-FIX1: active categories loaded by the server page
  categories: CategoryOption[];
}

export function SupportTicketsSection({
  trackingToken,
  initialTickets,
  categories,
}: Props) {
  const [tickets, setTickets] = useState<CustomerTicketRow[]>(
    initialTickets.map(rehydrateDates),
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const categoryLabelByCode = new Map(categories.map((c) => [c.code, c.name]));

  function onTicketCreated(newRow: CustomerTicketRow) {
    setTickets((prev) => [newRow, ...prev]);
  }

  function onTicketReopened(ticketId: string) {
    setTickets((prev) =>
      prev.map((t) =>
        t.id === ticketId
          ? { ...t, status: 'open', resolvedAt: null, reopenedAt: new Date() }
          : t,
      ),
    );
  }

  return (
    <section className="space-y-4" aria-label="Support">
      <Button
        type="button"
        variant="outline"
        className="w-full h-12 text-base"
        onClick={() => setDialogOpen(true)}
      >
        <Icon name="support_agent" size="sm" />
        Need help with this order?
      </Button>

      {tickets.length > 0 ? (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground">
            Your support requests
          </h3>
          <ul className="space-y-3">
            {tickets.map((t) => (
              <TicketCard
                key={t.id}
                ticket={t}
                trackingToken={trackingToken}
                onReopened={() => onTicketReopened(t.id)}
                categoryLabel={categoryLabelByCode.get(t.category) ?? t.category}
              />
            ))}
          </ul>
        </div>
      ) : null}

      <SubmitDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        trackingToken={trackingToken}
        categories={categories}
        onSuccess={onTicketCreated}
      />
    </section>
  );
}

function TicketCard({
  ticket,
  trackingToken,
  onReopened,
  categoryLabel,
}: {
  ticket: CustomerTicketRow;
  trackingToken: string;
  onReopened: () => void;
  categoryLabel: string;
}) {
  const [reopening, setReopening] = useState(false);
  const reopenTurnstileRef = useRef<HTMLDivElement | null>(null);
  const reopenWidgetIdRef = useRef<string | null>(null);
  const [reopenToken, setReopenToken] = useState<string>('');
  const [reopenWidgetOpen, setReopenWidgetOpen] = useState(false);

  // Render an invisible Turnstile widget on demand when the customer
  // clicks "Not resolved? Let us know" so we have a token to send.
  useEffect(() => {
    if (!reopenWidgetOpen) return;
    if (!TURNSTILE_SITE_KEY) return;
    const tryRender = () => {
      const ts = window.turnstile;
      const el = reopenTurnstileRef.current;
      if (!ts || !el) return false;
      if (reopenWidgetIdRef.current) return true;
      reopenWidgetIdRef.current = ts.render(el, {
        sitekey: TURNSTILE_SITE_KEY,
        size: 'invisible',
        callback: (token: string) => setReopenToken(token),
        'error-callback': () => setReopenToken(''),
        'expired-callback': () => setReopenToken(''),
      });
      return true;
    };
    if (!tryRender()) {
      const t = setInterval(() => {
        if (tryRender()) clearInterval(t);
      }, 200);
      return () => clearInterval(t);
    }
  }, [reopenWidgetOpen]);

  // Once the Turnstile token arrives + the customer clicked the button,
  // fire the POST.
  useEffect(() => {
    if (!reopenWidgetOpen || !reopenToken || reopening) return;
    void (async () => {
      setReopening(true);
      try {
        const res = await fetch(
          `/api/customer/support-tickets/${ticket.id}/reopen`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              trackingToken,
              turnstileToken: reopenToken,
            }),
          },
        );
        const j = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
        };
        if (!res.ok || !j.ok) {
          toast.error(j.error ?? 'Could not reopen — please try again');
          return;
        }
        toast.success('Reopened — we\'ll be in touch');
        onReopened();
      } catch {
        toast.error('Network error — please try again');
      } finally {
        setReopening(false);
        setReopenWidgetOpen(false);
        setReopenToken('');
        if (reopenWidgetIdRef.current && window.turnstile) {
          window.turnstile.remove(reopenWidgetIdRef.current);
          reopenWidgetIdRef.current = null;
        }
      }
    })();
  }, [reopenWidgetOpen, reopenToken, reopening, onReopened, ticket.id, trackingToken]);

  const style = STATUS_STYLE[ticket.status];
  const showsReopen = ticket.status === 'resolved';

  return (
    <li className="rounded-2xl border bg-card p-4 space-y-2">
      <div className="flex items-start gap-2 flex-wrap">
        <Badge variant="outline" className={cn('text-[10px]', style.cls)}>
          {style.label}
        </Badge>
        <Badge variant="outline" className="text-[10px]">
          {categoryLabel}
        </Badge>
        <p className="text-sm font-medium flex-1 min-w-0">{ticket.subject}</p>
      </div>
      <p className="text-xs text-muted-foreground">
        {ticket.status === 'resolved' && ticket.resolvedAt
          ? `Resolved ${relativeTime(ticket.resolvedAt)}`
          : ticket.status === 'in_progress' && ticket.ownerFirstName
            ? `Raised ${relativeTime(ticket.openedAt)} · ${ticket.ownerFirstName} is handling this`
            : `Raised ${relativeTime(ticket.openedAt)}`}
      </p>
      {showsReopen ? (
        <div className="pt-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={reopening || reopenWidgetOpen}
            onClick={() => setReopenWidgetOpen(true)}
          >
            {reopening ? 'Reopening…' : 'Not resolved? Let us know'}
          </Button>
          {/* Invisible Turnstile widget container */}
          <div ref={reopenTurnstileRef} className="sr-only" aria-hidden />
        </div>
      ) : null}
    </li>
  );
}

function SubmitDialog({
  open,
  onOpenChange,
  trackingToken,
  categories,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trackingToken: string;
  categories: CategoryOption[];
  onSuccess: (row: CustomerTicketRow) => void;
}) {
  const defaultCategory = categories[0]?.code ?? 'other';
  const [subject, setSubject] = useState('');
  // HVA-256-FIX1: category is an open string (from admin-managed table).
  const [category, setCategory] = useState<string>(defaultCategory);
  const [description, setDescription] = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const turnstileContainerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);

  // Render Turnstile when the dialog opens; remove when it closes.
  useEffect(() => {
    if (!open) return;
    if (!TURNSTILE_SITE_KEY) return;
    let cancelled = false;
    const tryRender = () => {
      if (cancelled) return false;
      const ts = window.turnstile;
      const el = turnstileContainerRef.current;
      if (!ts || !el) return false;
      if (widgetIdRef.current) return true;
      widgetIdRef.current = ts.render(el, {
        sitekey: TURNSTILE_SITE_KEY,
        size: 'flexible',
        callback: (t: string) => setTurnstileToken(t),
        'error-callback': () => setTurnstileToken(''),
        'expired-callback': () => setTurnstileToken(''),
      });
      return true;
    };
    if (!tryRender()) {
      const t = setInterval(() => {
        if (tryRender()) clearInterval(t);
      }, 200);
      return () => {
        cancelled = true;
        clearInterval(t);
      };
    }
    return () => {
      cancelled = true;
    };
  }, [open]);

  function resetForm() {
    setSubject('');
    setCategory(defaultCategory);
    setDescription('');
    setTurnstileToken('');
    if (widgetIdRef.current && window.turnstile) {
      window.turnstile.remove(widgetIdRef.current);
      widgetIdRef.current = null;
    }
  }

  async function onSubmit() {
    if (submitting) return;
    const trimmedSubject = subject.trim();
    const trimmedDescription = description.trim();
    if (!trimmedSubject) {
      toast.error('Add a short subject');
      return;
    }
    if (!trimmedDescription) {
      toast.error('Tell us a bit more in the details');
      return;
    }
    if (!turnstileToken) {
      toast.error('Please complete the challenge above');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/customer/support-tickets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          trackingToken,
          subject: trimmedSubject,
          description: trimmedDescription,
          category,
          turnstileToken,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        ticketId?: string;
        error?: string;
      };
      if (!res.ok || !j.ok || !j.ticketId) {
        toast.error(j.error ?? 'Could not send — please try again');
        return;
      }
      toast.success("Got it — we'll be in touch");
      onSuccess({
        id: j.ticketId,
        subject: trimmedSubject,
        category,
        status: 'open',
        openedAt: new Date(),
        resolvedAt: null,
        reopenedAt: null,
        ownerFirstName: null,
      });
      onOpenChange(false);
      resetForm();
    } catch {
      toast.error('Network error — please try again');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !submitting) resetForm();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>We're here to help</DialogTitle>
          <DialogDescription>
            Tell us what's going on — your sales executive and their team
            will get back to you on WhatsApp.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ticket-subject">
              Subject <span className="text-destructive">*</span>
            </Label>
            <Input
              id="ticket-subject"
              maxLength={200}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g. Wrong fabric colour delivered"
              disabled={submitting}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ticket-category">
              Category <span className="text-destructive">*</span>
            </Label>
            <Select
              value={category}
              onValueChange={(v) => setCategory(v)}
              disabled={submitting}
            >
              <SelectTrigger id="ticket-category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="ticket-description">
              Details <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="ticket-description"
              rows={4}
              maxLength={2000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Tell us what happened, with as much detail as you can."
              disabled={submitting}
            />
            <p className="text-[11px] text-muted-foreground">
              {description.length} / 2000 characters
            </p>
          </div>
          <div
            ref={turnstileContainerRef}
            className="min-h-[65px]"
            aria-label="Verification"
          />
        </div>
        <DialogFooter className="flex-row justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button type="button" onClick={onSubmit} disabled={submitting}>
            {submitting ? 'Sending…' : 'Send'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Server passes ISO strings inside CustomerTicketRow.openedAt etc when
// the component hydrates. Rehydrate to Date objects for the relative
// time helper.
function rehydrateDates(row: CustomerTicketRow): CustomerTicketRow {
  return {
    ...row,
    openedAt:
      row.openedAt instanceof Date ? row.openedAt : new Date(row.openedAt),
    resolvedAt: row.resolvedAt
      ? row.resolvedAt instanceof Date
        ? row.resolvedAt
        : new Date(row.resolvedAt)
      : null,
    reopenedAt: row.reopenedAt
      ? row.reopenedAt instanceof Date
        ? row.reopenedAt
        : new Date(row.reopenedAt)
      : null,
  };
}
