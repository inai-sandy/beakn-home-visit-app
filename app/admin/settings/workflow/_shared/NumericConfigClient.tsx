'use client';

import { useTransition, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { setNumericWorkflowConfigAction } from './numeric-config-actions';

interface Props {
  configKey:
    | 'pending_captain_approval_timeout_hours'
    | 'refund_window_days'
    | 'audit_log_retention_months';
  currentValue: number;
  label: string;
  unit: string;
  /** Max input value. Schema enforces 0..3650 globally; per-page caps narrow it. */
  max: number;
  /** What `value=0` means. Set null if 0 is a valid normal value. */
  zeroMeans?: string;
}

export function NumericConfigClient({
  configKey,
  currentValue,
  label,
  unit,
  max,
  zeroMeans,
}: Props) {
  const router = useRouter();
  const [draft, setDraft] = useState<string>(String(currentValue));
  const [pending, startTransition] = useTransition();

  const parsed = Number.parseInt(draft, 10);
  const isValid = Number.isInteger(parsed) && parsed >= 0 && parsed <= max;
  const dirty = isValid && parsed !== currentValue;

  function save() {
    if (!isValid || !dirty) return;
    startTransition(async () => {
      const result = await setNumericWorkflowConfigAction({
        key: configKey,
        value: parsed,
      });
      if (result.ok) {
        toast.success(
          parsed === 0 && zeroMeans
            ? `Saved — ${zeroMeans}`
            : `Saved — ${parsed} ${unit}`,
        );
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="rounded-3xl border bg-card p-5 shadow-sm space-y-4">
      <div className="space-y-1">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
          Current value
        </p>
        <p className="text-3xl font-bold tabular-nums tracking-tight">
          {currentValue === 0 && zeroMeans
            ? <span className="text-muted-foreground italic">{zeroMeans}</span>
            : `${currentValue} ${unit}`}
        </p>
      </div>
      <div className="flex items-end gap-3 flex-wrap">
        <label className="space-y-1 flex-1 min-w-[200px]">
          <span className="text-xs text-muted-foreground">{label}</span>
          <Input
            type="number"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            min={0}
            max={max}
            className="h-11 tabular-nums"
            disabled={pending}
          />
        </label>
        <Button onClick={save} disabled={!isValid || !dirty || pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
      </div>
      {!isValid && draft.length > 0 && (
        <p className="text-xs text-destructive">
          Enter a whole number between 0 and {max}.
        </p>
      )}
    </div>
  );
}
