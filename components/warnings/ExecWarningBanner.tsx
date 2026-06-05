import Link from 'next/link';

import { Icon } from '@/components/ui/icon';
import { HARD_WARNING_FIRE_THRESHOLD } from '@/lib/warnings/metrics';
import type { WarningHistoryRow } from '@/lib/warnings/queries';
import type { ActiveWarningCounts } from '@/lib/warnings/queries';

// =============================================================================
// HVA-229: ExecWarningBanner — prominent alert on exec-facing surfaces
// =============================================================================
//
// Replaces the small WarningCountsPill on /dashboard + /today when the
// exec has any active warnings. Color-coded by severity:
//
//   - hard >= 5     → deep-rose "termination eligibility" alert
//   - any hard      → rose alert with count
//   - soft-only     → amber motivational nudge
//   - clean         → nothing rendered
//
// Shows the title of the most recent active warning so the exec sees
// what's flagged at a glance, plus a "View details" link to the
// warnings drill page on the captain side. Sandeep's contact line is
// inline so the exec doesn't need to dig.
// =============================================================================

interface Props {
  counts: ActiveWarningCounts;
  /** Optional: latest non-revoked warning, used to surface the most
   *  recent issue title in the banner. If null, banner shows the
   *  generic message. */
  latest?: WarningHistoryRow | null;
  /** Where the "View details" link goes — exec drill on captain side. */
  drillHref?: string;
}

const SANDEEP_PHONE = '+91 98856 98665';

export function ExecWarningBanner({ counts, latest, drillHref }: Props) {
  const { softActive, hardActive, hardThreshold, fireFlag } = counts;
  if (softActive === 0 && hardActive === 0) return null;

  const tone = fireFlag
    ? 'fire'
    : hardActive > 0
      ? 'hard'
      : 'soft';

  const styles = {
    fire: {
      border: 'border-rose-500',
      bg: 'bg-rose-50 dark:bg-rose-950/30',
      icon: 'bg-rose-600 text-white',
      iconName: 'gpp_bad',
      title: 'text-rose-900 dark:text-rose-100',
      body: 'text-rose-800 dark:text-rose-200',
    },
    hard: {
      border: 'border-rose-300',
      bg: 'bg-rose-50/60 dark:bg-rose-950/20',
      icon: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
      iconName: 'gpp_bad',
      title: 'text-rose-900 dark:text-rose-100',
      body: 'text-rose-800 dark:text-rose-200',
    },
    soft: {
      border: 'border-amber-300',
      bg: 'bg-amber-50/60 dark:bg-amber-950/20',
      icon: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
      iconName: 'campaign',
      title: 'text-amber-900 dark:text-amber-100',
      body: 'text-amber-800 dark:text-amber-200',
    },
  }[tone];

  const heading =
    tone === 'fire'
      ? `You have reached ${hardActive}/${HARD_WARNING_FIRE_THRESHOLD} hard warnings`
      : tone === 'hard'
        ? `You have ${hardActive} hard warning${hardActive === 1 ? '' : 's'} on record`
        : `Performance check-in from Sandeep`;

  const subline =
    tone === 'fire'
      ? `Your role at Beakn is at serious risk. Speak to your captain immediately.`
      : tone === 'hard'
        ? `${hardActive}/${hardThreshold} hard, ${softActive} soft warning${softActive === 1 ? '' : 's'} active. Speak to your captain to discuss revocation.`
        : `You have ${softActive} active soft warning${softActive === 1 ? '' : 's'}. Read the message and reach out if you need help.`;

  return (
    <section
      role="alert"
      aria-label="Active performance warnings"
      className={`rounded-2xl border-2 ${styles.border} ${styles.bg} p-4 sm:p-5 space-y-3 shadow-sm`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`grid place-items-center w-10 h-10 rounded-full shrink-0 ${styles.icon}`}
          aria-hidden
        >
          <Icon name={styles.iconName} size="sm" />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <p className={`text-sm sm:text-base font-semibold tracking-tight ${styles.title}`}>
            {heading}
          </p>
          <p className={`text-[12px] sm:text-[13px] leading-relaxed ${styles.body}`}>
            {subline}
          </p>
        </div>
      </div>

      {latest && (
        <div className="rounded-xl bg-background/60 border border-border/60 p-3 space-y-1">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Most recent
          </p>
          <p className="text-[12px] font-medium leading-snug">
            {latest.metricCode} · {latest.periodLabel} · current{' '}
            {latest.currentValue} / target {latest.targetValue}
          </p>
          <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2">
            {latest.reason}
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <p className={`text-[11px] ${styles.body}`}>
          Reach Sandeep directly:{' '}
          <a
            href={`tel:${SANDEEP_PHONE.replace(/\s+/g, '')}`}
            className="font-semibold underline-offset-2 hover:underline"
          >
            {SANDEEP_PHONE}
          </a>
        </p>
        {drillHref && (
          <Link
            href={drillHref}
            className="inline-flex items-center gap-1 text-[11px] font-medium rounded-full border bg-background px-3 py-1 hover:bg-accent transition-colors"
          >
            View details
            <Icon name="arrow_forward" size="xs" />
          </Link>
        )}
      </div>
    </section>
  );
}
