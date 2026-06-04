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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

import {
  createStatusStageAction,
  deleteStatusStageAction,
  updateStatusStageAction,
} from '../actions';

import type { StatusStageRow } from '@/lib/admin/status-stages';

interface Props {
  stages: StatusStageRow[];
}

type ModalMode =
  | { kind: 'closed' }
  | { kind: 'add' }
  | { kind: 'edit'; stage: StatusStageRow }
  | { kind: 'delete'; stage: StatusStageRow };

interface EditableState {
  name: string;
  sequenceNumber: number;
  isActive: boolean;
  isTerminal: boolean;
  description: string;
}

function toEditable(s: StatusStageRow): EditableState {
  return {
    name: s.name,
    sequenceNumber: s.sequenceNumber,
    isActive: s.isActive,
    isTerminal: s.isTerminal,
    description: s.description ?? '',
  };
}

export function StatusStagesClient({ stages }: Props) {
  const [modal, setModal] = useState<ModalMode>({ kind: 'closed' });

  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-muted-foreground">
          {stages.length} stage{stages.length === 1 ? '' : 's'} configured.
          Sorted by sequence number.
        </p>
        <Button onClick={() => setModal({ kind: 'add' })}>
          <Icon name="add" size="sm" />
          <span>Add stage</span>
        </Button>
      </div>

      <ul className="space-y-3">
        {stages.map((s) => (
          <StageRow
            key={s.id}
            stage={s}
            onDelete={() => setModal({ kind: 'delete', stage: s })}
          />
        ))}
      </ul>

      {modal.kind === 'add' && (
        <StageFormModal
          mode="add"
          onClose={() => setModal({ kind: 'closed' })}
        />
      )}

      {modal.kind === 'delete' && (
        <DeleteConfirmModal
          stage={modal.stage}
          onClose={() => setModal({ kind: 'closed' })}
        />
      )}
    </>
  );
}

// -----------------------------------------------------------------------------
// Per-row card with inline edit
// -----------------------------------------------------------------------------

function StageRow({
  stage,
  onDelete,
}: {
  stage: StatusStageRow;
  onDelete: () => void;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<EditableState>(() => toEditable(stage));
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);

  const dirty =
    draft.name !== stage.name ||
    draft.sequenceNumber !== stage.sequenceNumber ||
    draft.isActive !== stage.isActive ||
    draft.isTerminal !== stage.isTerminal ||
    (draft.description ?? '') !== (stage.description ?? '');

  function save() {
    startTransition(async () => {
      const result = await updateStatusStageAction({
        id: stage.id,
        name: draft.name.trim(),
        sequenceNumber: draft.sequenceNumber,
        isActive: draft.isActive,
        isTerminal: draft.isTerminal,
        description: draft.description.trim().length > 0
          ? draft.description.trim()
          : null,
      });
      if (result.ok) {
        toast.success(`Updated "${draft.name}"`);
        setEditing(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function reset() {
    setDraft(toEditable(stage));
    setEditing(false);
  }

  return (
    <li className="rounded-2xl border bg-card p-4 sm:p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-mono text-muted-foreground bg-muted/50 rounded px-2 py-0.5">
              {stage.code}
            </span>
            <Badge variant={stage.isActive ? 'secondary' : 'outline'} className="text-[10px]">
              {stage.isActive ? 'Active' : 'Inactive'}
            </Badge>
            {stage.isTerminal && (
              <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-700">
                Terminal
              </Badge>
            )}
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {stage.requestCount} request{stage.requestCount === 1 ? '' : 's'}
            </span>
          </div>
          {!editing ? (
            <>
              <p className="text-base font-semibold tracking-tight">
                {stage.name}{' '}
                <span className="text-xs text-muted-foreground font-normal">
                  · seq {stage.sequenceNumber}
                </span>
              </p>
              {stage.description && (
                <p className="text-xs text-muted-foreground max-w-xl">
                  {stage.description}
                </p>
              )}
            </>
          ) : (
            <EditFields draft={draft} setDraft={setDraft} />
          )}
        </div>
        <div className="flex gap-2 shrink-0">
          {!editing ? (
            <>
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                Edit
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={onDelete}
                disabled={stage.requestCount > 0}
                title={
                  stage.requestCount > 0
                    ? `Cannot delete — ${stage.requestCount} requests reference this stage`
                    : undefined
                }
              >
                <Icon name="delete" size="xs" />
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="outline" onClick={reset} disabled={pending}>
                Cancel
              </Button>
              <Button size="sm" onClick={save} disabled={!dirty || pending}>
                {pending ? 'Saving…' : 'Save'}
              </Button>
            </>
          )}
        </div>
      </div>
    </li>
  );
}

function EditFields({
  draft,
  setDraft,
}: {
  draft: EditableState;
  setDraft: (next: EditableState) => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2 max-w-2xl">
      <label className="space-y-1">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
          Label
        </span>
        <Input
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          maxLength={100}
          className="h-9"
        />
      </label>
      <label className="space-y-1">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
          Sequence
        </span>
        <Input
          type="number"
          value={draft.sequenceNumber}
          onChange={(e) =>
            setDraft({
              ...draft,
              sequenceNumber: Number.parseInt(e.target.value, 10) || 0,
            })
          }
          min={0}
          max={999}
          className="h-9 tabular-nums"
        />
      </label>
      <label className="sm:col-span-2 space-y-1">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
          Description (admin-only)
        </span>
        <Textarea
          value={draft.description}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          maxLength={2000}
          rows={2}
          placeholder="Optional internal note explaining what this stage means."
        />
      </label>
      <div className="flex items-center gap-3 flex-wrap">
        <label className="flex items-center gap-2">
          <Switch
            checked={draft.isActive}
            onCheckedChange={(v) => setDraft({ ...draft, isActive: v })}
          />
          <span className="text-sm">Active</span>
        </label>
        <label className="flex items-center gap-2">
          <Switch
            checked={draft.isTerminal}
            onCheckedChange={(v) => setDraft({ ...draft, isTerminal: v })}
          />
          <span className="text-sm">Terminal</span>
        </label>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Add modal
// -----------------------------------------------------------------------------

function StageFormModal({
  mode,
  onClose,
}: {
  mode: 'add';
  onClose: () => void;
}) {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [sequenceNumber, setSequenceNumber] = useState(0);
  const [isActive, setIsActive] = useState(true);
  const [isTerminal, setIsTerminal] = useState(false);
  const [description, setDescription] = useState('');
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const result = await createStatusStageAction({
        code: code.trim(),
        name: name.trim(),
        sequenceNumber,
        isActive,
        isTerminal,
        description: description.trim().length > 0 ? description.trim() : null,
      });
      if (result.ok) {
        toast.success(`Added stage "${name}"`);
        router.refresh();
        onClose();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a new status stage</DialogTitle>
          <DialogDescription>
            The <code className="font-mono">code</code> is the stable
            identifier — it cannot be renamed later. Use UPPER_SNAKE_CASE.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="new-stage-code">Code</Label>
            <Input
              id="new-stage-code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
              placeholder="E.G. CUSTOMER_REJECTED"
              maxLength={64}
              className="font-mono"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-stage-name">Label</Label>
            <Input
              id="new-stage-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Customer rejected"
              maxLength={100}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-stage-seq">Sequence number</Label>
            <Input
              id="new-stage-seq"
              type="number"
              value={sequenceNumber}
              onChange={(e) => setSequenceNumber(Number.parseInt(e.target.value, 10) || 0)}
              min={0}
              max={999}
              className="tabular-nums"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-stage-desc">Description (admin-only)</Label>
            <Textarea
              id="new-stage-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
              rows={2}
            />
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <label className="flex items-center gap-2">
              <Switch checked={isActive} onCheckedChange={setIsActive} />
              <span className="text-sm">Active</span>
            </label>
            <label className="flex items-center gap-2">
              <Switch checked={isTerminal} onCheckedChange={setIsTerminal} />
              <span className="text-sm">Terminal</span>
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={
              pending || code.trim().length === 0 || name.trim().length === 0
            }
          >
            {pending ? 'Adding…' : 'Add stage'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// -----------------------------------------------------------------------------
// Delete confirm
// -----------------------------------------------------------------------------

function DeleteConfirmModal({
  stage,
  onClose,
}: {
  stage: StatusStageRow;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const result = await deleteStatusStageAction({ id: stage.id });
      if (result.ok) {
        toast.success(`Deleted stage "${stage.name}"`);
        router.refresh();
        onClose();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Delete &ldquo;{stage.name}&rdquo;?</DialogTitle>
          <DialogDescription>
            This removes the stage from the catalog. The <code className="font-mono">{stage.code}</code> identifier
            becomes available for re-use. Cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
