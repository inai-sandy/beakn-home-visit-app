'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

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

import { issueWarningAction } from '@/lib/warnings/actions';
import { composeWarningMessage } from '@/lib/warnings/compose';
import {
  HARD_WARNING_FIRE_THRESHOLD,
  WARNING_METRICS,
  WARNING_PERIODS,
  metricByCode,
} from '@/lib/warnings/metrics';

// =============================================================================
// HVA-228: IssueWarningDialog — admin-facing form to issue a warning
// =============================================================================
//
// Reused for both `kind = 'soft' | 'hard'`. The trigger button passes
// the exec details + the kind; the dialog handles the rest.
//
// All template variables are surfaced as form fields so the admin can
// see exactly what's being filled in. Live preview at the bottom
// renders the same composer the server uses, so what the admin sees
// is what the exec receives.
//
// Hard warnings get a red destructive style + a more emphatic
// confirmation copy in the footer. Misclick safety: button disabled
// until reason has ≥ 10 chars and current/target are non-negative
// numbers.
// =============================================================================

interface Props {
  open: boolean;
  onClose: () => void;
  kind: 'soft' | 'hard';
  execUserId: string;
  execName: string;
  captainName: string | null;
  /** Active hard warning count BEFORE this issue. Used to show "this
   *  will be hard warning N+1 of 5" in the header. */
  currentHardCount: number;
}

export function IssueWarningDialog({
  open,
  onClose,
  kind,
  execUserId,
  execName,
  captainName,
  currentHardCount,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [metricCode, setMetricCode] = useState<string>(WARNING_METRICS[0].code);
  const [periodCode, setPeriodCode] = useState<string>(WARNING_PERIODS[0].code);
  const [currentValue, setCurrentValue] = useState('');
  const [targetValue, setTargetValue] = useState('');
  const [reason, setReason] = useState('');

  const metric = metricByCode(metricCode);
  const unitHint =
    metric?.unit === 'paise'
      ? 'paise — ₹100 = 10000'
      : metric?.unit === 'percent'
        ? 'tenths of a percent — 47.5% = 475'
        : 'whole count';

  const currentNum = Number(currentValue);
  const targetNum = Number(targetValue);
  const isValidNums =
    !Number.isNaN(currentNum) &&
    !Number.isNaN(targetNum) &&
    currentValue !== '' &&
    targetValue !== '' &&
    currentNum >= 0 &&
    targetNum >= 0;
  const isValid = isValidNums && reason.trim().length >= 10;

  const nextHardCount =
    kind === 'hard' ? currentHardCount + 1 : currentHardCount;

  const previewMessage = useMemo(() => {
    if (!isValidNums || reason.trim().length === 0) {
      return null;
    }
    return composeWarningMessage({
      kind,
      execName,
      captainName,
      metricCode,
      periodCode,
      currentValue: currentNum,
      targetValue: targetNum,
      reason: reason.trim(),
      hardCount: nextHardCount,
    });
  }, [
    isValidNums,
    reason,
    kind,
    execName,
    captainName,
    metricCode,
    periodCode,
    currentNum,
    targetNum,
    nextHardCount,
  ]);

  function reset() {
    setMetricCode(WARNING_METRICS[0].code);
    setPeriodCode(WARNING_PERIODS[0].code);
    setCurrentValue('');
    setTargetValue('');
    setReason('');
  }

  function submit() {
    if (!isValid) return;
    startTransition(async () => {
      const result = await issueWarningAction({
        execUserId,
        kind,
        metricCode,
        periodCode,
        currentValue: currentNum,
        targetValue: targetNum,
        reason: reason.trim(),
      });
      if (result.ok) {
        toast.success(
          kind === 'hard'
            ? `Hard warning ${nextHardCount}/${HARD_WARNING_FIRE_THRESHOLD} issued`
            : 'Soft warning issued',
        );
        reset();
        onClose();
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  const isHard = kind === 'hard';

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon
              name={isHard ? 'gpp_bad' : 'campaign'}
              size="sm"
              className={isHard ? 'text-rose-600' : 'text-amber-600'}
            />
            {isHard ? 'Issue HARD warning' : 'Issue soft warning'} —{' '}
            {execName}
          </DialogTitle>
          <DialogDescription className="space-y-1">
            {isHard ? (
              <span className="text-rose-700 font-medium">
                This will be hard warning {nextHardCount} of{' '}
                {HARD_WARNING_FIRE_THRESHOLD}.{' '}
                {nextHardCount === HARD_WARNING_FIRE_THRESHOLD
                  ? 'After this, the exec is flagged for termination.'
                  : ''}
              </span>
            ) : (
              <span>A motivational nudge sent in-app + push.</span>
            )}
            <span className="block text-[11px] text-muted-foreground">
              Captain: {captainName ?? '—'}
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="warning-metric">Metric</Label>
              <Select value={metricCode} onValueChange={setMetricCode}>
                <SelectTrigger id="warning-metric" className="h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WARNING_METRICS.map((m) => (
                    <SelectItem key={m.code} value={m.code}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="warning-period">Period</Label>
              <Select value={periodCode} onValueChange={setPeriodCode}>
                <SelectTrigger id="warning-period" className="h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WARNING_PERIODS.map((p) => (
                    <SelectItem key={p.code} value={p.code}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="warning-current">Current value</Label>
              <Input
                id="warning-current"
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={currentValue}
                onChange={(e) => setCurrentValue(e.target.value)}
                className="h-10"
              />
              <p className="text-[10px] text-muted-foreground">{unitHint}</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="warning-target">Target value</Label>
              <Input
                id="warning-target"
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={targetValue}
                onChange={(e) => setTargetValue(e.target.value)}
                className="h-10"
              />
              <p className="text-[10px] text-muted-foreground">{unitHint}</p>
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="warning-reason">
              Reason / specifics{' '}
              <span className="text-muted-foreground text-[10px]">
                (10–500 chars, required)
              </span>
            </Label>
            <Textarea
              id="warning-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="What specifically about their performance prompted this warning?"
              className="resize-none"
            />
            <p className="text-[10px] text-muted-foreground text-right">
              {reason.length} / 500
            </p>
          </div>

          {/* Live preview */}
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Preview — what the exec will see
            </Label>
            <div
              className={`rounded-xl border p-3 text-[12px] whitespace-pre-wrap leading-relaxed ${
                isHard ? 'border-rose-300 bg-rose-50/40 dark:bg-rose-950/20' : 'bg-muted/30'
              }`}
            >
              {previewMessage ?? (
                <span className="text-muted-foreground italic">
                  Fill in metric, period, current, target, and reason to see the preview…
                </span>
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => {
              reset();
              onClose();
            }}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={!isValid || pending}
            className={
              isHard
                ? 'bg-rose-600 hover:bg-rose-700 text-white border-rose-700'
                : ''
            }
          >
            {pending
              ? 'Sending…'
              : isHard
                ? `Send HARD warning (${nextHardCount}/${HARD_WARNING_FIRE_THRESHOLD})`
                : 'Send soft warning'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
