import {
  formatMetricValue,
  metricByCode,
  periodByCode,
} from './metrics';

// =============================================================================
// HVA-228: warning message rendering
// =============================================================================
//
// Two predefined templates. Called by the server action to produce the
// `message_snapshot` stored on the warning row, and reused by the
// IssueWarningDialog preview pane so admin sees exactly what will be
// sent before clicking submit.
//
// Template-only. Admin cannot edit copy at issue time — they pick
// metric/period/current/target/reason and the template renders around
// those values.
//
// `hardCount` is the count AFTER this warning is recorded (so the
// first hard warning shows "1/5" not "0/5"). Caller computes this
// before invoking compose.
// =============================================================================

export interface ComposeWarningInput {
  kind: 'soft' | 'hard';
  execName: string;
  captainName: string | null;
  metricCode: string;
  periodCode: string;
  currentValue: number;
  targetValue: number;
  reason: string;
  /** 1..N — only used for `kind === 'hard'`. */
  hardCount?: number;
}

export const HARD_WARNING_FIRE_THRESHOLD = 5;

function fmt(metricCode: string, value: number): string {
  const m = metricByCode(metricCode);
  if (!m) return value.toString();
  return formatMetricValue(value, m.unit);
}

function metricLabel(metricCode: string): string {
  return metricByCode(metricCode)?.label ?? metricCode;
}

function periodLabel(periodCode: string): string {
  return periodByCode(periodCode)?.label ?? periodCode;
}

const SANDEEP_PHONE = '+91 98856 98665';

export function composeSoftWarningMessage(
  input: ComposeWarningInput,
): string {
  const metric = metricLabel(input.metricCode);
  const period = periodLabel(input.periodCode);
  const current = fmt(input.metricCode, input.currentValue);
  const target = fmt(input.metricCode, input.targetValue);
  return [
    `Hi ${input.execName}, this is a check-in from Sandeep.`,
    ``,
    `Your ${metric} for ${period} is ${current} against a target of ${target}.`,
    ``,
    `Specifically: ${input.reason}`,
    ``,
    `If something's blocking you — a tough customer, a tool not working, anything personal — reach me at ${SANDEEP_PHONE}. We'll figure it out together.`,
    ``,
    `Looking forward to seeing you turn this around.`,
    ``,
    `— Sandeep`,
  ].join('\n');
}

export function composeHardWarningMessage(
  input: ComposeWarningInput,
): string {
  const metric = metricLabel(input.metricCode);
  const period = periodLabel(input.periodCode);
  const current = fmt(input.metricCode, input.currentValue);
  const target = fmt(input.metricCode, input.targetValue);
  const hardCount = input.hardCount ?? 0;
  const captainLine =
    input.captainName != null
      ? `If you believe this is unwarranted, speak to your captain (${input.captainName}) within 48 hours.`
      : `If you believe this is unwarranted, speak to your captain within 48 hours.`;
  return [
    `${input.execName}, this is a formal performance notice from Sandeep.`,
    ``,
    `You have received hard warning ${hardCount}/${HARD_WARNING_FIRE_THRESHOLD}. After ${HARD_WARNING_FIRE_THRESHOLD}, your role at Beakn is at serious risk.`,
    ``,
    `Your ${metric} for ${period} is ${current} against a target of ${target}.`,
    ``,
    `Specifically: ${input.reason}`,
    ``,
    captainLine,
    ``,
    `— Sandeep`,
  ].join('\n');
}

export function composeWarningMessage(input: ComposeWarningInput): string {
  return input.kind === 'hard'
    ? composeHardWarningMessage(input)
    : composeSoftWarningMessage(input);
}
