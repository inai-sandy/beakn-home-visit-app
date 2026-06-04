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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

import type { TransitionRow } from '@/lib/admin/transitions';

import {
  setTransitionRequiresDatetimeAction,
  updateTransitionAction,
} from '../actions';

const ALLOWED_ROLES = [
  'sales_executive',
  'captain',
  'super_admin',
  'any',
] as const;

const TASK_TYPES = [
  'customer_home_visit',
  'sales_pitch',
  'outlet_visit',
  'follow_up',
  'installation',
  'stall_activity',
  'other',
] as const;

interface Props {
  transitions: TransitionRow[];
}

const KIND_BADGE: Record<string, { label: string; tone: string }> = {
  forward: {
    label: 'Forward',
    tone: 'bg-primary/10 text-primary border-primary/30',
  },
  forward_skip: {
    label: 'Forward skip',
    tone: 'bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-950/30 dark:text-sky-200',
  },
  rollback: {
    label: 'Rollback',
    tone: 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/30 dark:text-amber-200',
  },
  specific_backward: {
    label: 'Captain reject',
    tone: 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/30 dark:text-rose-200',
  },
};

export function TransitionsClient({ transitions }: Props) {
  const [editing, setEditing] = useState<TransitionRow | null>(null);

  return (
    <>
      <div className="rounded-2xl border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/40">
              <tr>
                <th className="text-left py-2.5 px-3">From</th>
                <th className="text-left py-2.5 px-3">To</th>
                <th className="text-left py-2.5 px-3">Kind</th>
                <th className="text-left py-2.5 px-3">Role</th>
                <th className="text-center py-2.5 px-3" title="Requires reason">
                  Reason
                </th>
                <th className="text-center py-2.5 px-3" title="Requires quotation">
                  Quote
                </th>
                <th className="text-center py-2.5 px-3" title="Requires date+time picker">
                  Date+time
                </th>
                <th className="text-left py-2.5 px-3">Auto-task</th>
                <th className="text-left py-2.5 px-3">Event</th>
                <th className="text-center py-2.5 px-3">Active</th>
                <th className="text-right py-2.5 px-3">Edit</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {transitions.map((t) => (
                <TransitionRowView
                  key={t.id}
                  row={t}
                  onEdit={() => setEditing(t)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <EditTransitionModal
          row={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function TransitionRowView({
  row,
  onEdit,
}: {
  row: TransitionRow;
  onEdit: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const kindBadge = KIND_BADGE[row.kind] ?? {
    label: row.kind,
    tone: 'bg-muted/40 text-muted-foreground border-muted',
  };

  function toggleRequiresDatetime(next: boolean) {
    startTransition(async () => {
      const result = await setTransitionRequiresDatetimeAction({
        id: row.id,
        requiresDatetime: next,
      });
      if (result.ok) {
        toast.success(
          next
            ? `Calendar picker enabled for ${row.toName}`
            : `Calendar picker disabled for ${row.toName}`,
        );
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <tr className="hover:bg-muted/30">
      <td className="py-2.5 px-3">
        <p className="text-sm font-medium tracking-tight">{row.fromName}</p>
        <p className="text-[10px] text-muted-foreground font-mono">
          {row.fromCode}
        </p>
      </td>
      <td className="py-2.5 px-3">
        <p className="text-sm font-medium tracking-tight">{row.toName}</p>
        <p className="text-[10px] text-muted-foreground font-mono">
          {row.toCode}
        </p>
      </td>
      <td className="py-2.5 px-3">
        <Badge
          variant="outline"
          className={`text-[10px] ${kindBadge.tone}`}
        >
          {kindBadge.label}
        </Badge>
      </td>
      <td className="py-2.5 px-3">
        <Badge variant="outline" className="text-[10px]">
          {row.allowedRole}
        </Badge>
      </td>
      <td className="py-2.5 px-3 text-center">
        {row.requiresReason ? '✓' : <span className="text-muted-foreground/50">—</span>}
      </td>
      <td className="py-2.5 px-3 text-center">
        {row.requiresQuotation ? '✓' : <span className="text-muted-foreground/50">—</span>}
      </td>
      <td className="py-2.5 px-3 text-center">
        <Switch
          checked={row.requiresDatetime}
          disabled={pending}
          onCheckedChange={toggleRequiresDatetime}
          aria-label={`Toggle calendar picker for ${row.fromCode} to ${row.toCode}`}
        />
      </td>
      <td className="py-2.5 px-3">
        {row.autoTaskType ? (
          <span className="text-[11px] font-mono text-muted-foreground">
            {row.autoTaskType}
          </span>
        ) : (
          <span className="text-muted-foreground/50">—</span>
        )}
      </td>
      <td className="py-2.5 px-3">
        {row.emitsEvent ? (
          <span className="text-[11px] font-mono text-muted-foreground">
            {row.emitsEvent}
          </span>
        ) : (
          <span className="text-muted-foreground/50">—</span>
        )}
      </td>
      <td className="py-2.5 px-3 text-center">
        {row.isActive ? (
          <span className="text-emerald-600 text-xs">●</span>
        ) : (
          <Badge variant="outline" className="text-[10px] border-rose-300 text-rose-700">
            Disabled
          </Badge>
        )}
      </td>
      <td className="py-2.5 px-3 text-right">
        <Button size="sm" variant="outline" onClick={onEdit}>
          <Icon name="edit" size="xs" />
        </Button>
      </td>
    </tr>
  );
}

// -----------------------------------------------------------------------------
// Edit modal — full per-row patch
// -----------------------------------------------------------------------------

function EditTransitionModal({
  row,
  onClose,
}: {
  row: TransitionRow;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [allowedRole, setAllowedRole] = useState(row.allowedRole);
  const [requiresReason, setRequiresReason] = useState(row.requiresReason);
  const [requiresQuotation, setRequiresQuotation] = useState(
    row.requiresQuotation,
  );
  const [requiresDatetime, setRequiresDatetime] = useState(row.requiresDatetime);
  const [autoTaskType, setAutoTaskType] = useState<string>(
    row.autoTaskType ?? '__none__',
  );
  const [isActive, setIsActive] = useState(row.isActive);
  const [description, setDescription] = useState(row.description ?? '');

  function save() {
    startTransition(async () => {
      const result = await updateTransitionAction({
        id: row.id,
        allowedRole: allowedRole as (typeof ALLOWED_ROLES)[number],
        requiresReason,
        requiresQuotation,
        requiresDatetime,
        autoTaskType:
          autoTaskType === '__none__'
            ? null
            : (autoTaskType as (typeof TASK_TYPES)[number]),
        isActive,
        description: description.trim().length > 0 ? description.trim() : null,
      });
      if (result.ok) {
        toast.success(`Updated ${row.fromCode} → ${row.toCode}`);
        router.refresh();
        onClose();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            Edit transition: {row.fromName} → {row.toName}
          </DialogTitle>
          <DialogDescription>
            <span className="font-mono text-[11px]">
              {row.fromCode} → {row.toCode}
            </span>{' '}
            ·{' '}
            {KIND_BADGE[row.kind]?.label ?? row.kind}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="edit-role">Allowed role</Label>
              <Select value={allowedRole} onValueChange={setAllowedRole}>
                <SelectTrigger id="edit-role" className="h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ALLOWED_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-auto-task">Auto-create task</Label>
              <Select value={autoTaskType} onValueChange={setAutoTaskType}>
                <SelectTrigger id="edit-auto-task" className="h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— None —</SelectItem>
                  {TASK_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex items-center gap-2">
              <Switch
                checked={requiresReason}
                onCheckedChange={setRequiresReason}
              />
              <span className="text-sm">Requires reason</span>
            </label>
            <label className="flex items-center gap-2">
              <Switch
                checked={requiresQuotation}
                onCheckedChange={setRequiresQuotation}
              />
              <span className="text-sm">Requires quotation</span>
            </label>
            <label className="flex items-center gap-2">
              <Switch
                checked={requiresDatetime}
                onCheckedChange={setRequiresDatetime}
              />
              <span className="text-sm">Date+time picker</span>
            </label>
            <label className="flex items-center gap-2">
              <Switch checked={isActive} onCheckedChange={setIsActive} />
              <span className="text-sm">Active</span>
            </label>
          </div>

          <div className="space-y-1">
            <Label htmlFor="edit-description">Description (admin-only)</Label>
            <Textarea
              id="edit-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              maxLength={2000}
              placeholder="Optional internal note."
            />
          </div>

          {row.emitsEvent && (
            <p className="text-[11px] text-muted-foreground bg-muted/30 rounded px-2 py-1.5 font-mono">
              Emits event: {row.emitsEvent} (read-only — change requires a code update)
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={save} disabled={pending}>
            {pending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
