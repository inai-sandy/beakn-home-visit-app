import Link from 'next/link';

import { Icon } from '@/components/ui/icon';

import type { ActiveWarningCounts } from '@/lib/warnings/queries';

// =============================================================================
// HVA-228: WarningCountsPill — compact summary pill
// =============================================================================
//
// Server-rendered. Drops onto the exec's own dashboard + the captain's
// team-member view. Clickable when `linkHref` is set (default
// /today/warnings).
//
// When fireFlag is true (hardActive >= threshold) the pill renders
// with the rose destructive style. Otherwise amber if any soft/hard
// active, slate if clean.
// =============================================================================

interface Props {
  counts: ActiveWarningCounts;
  /** When set, the pill wraps in a Link to this href. */
  linkHref?: string;
  /** "Soft warnings: 2 · Hard warnings: 1" by default; pass a custom
   *  label string to override (e.g. captain view: "Veera's warnings"). */
  labelPrefix?: string;
}

export function WarningCountsPill({
  counts,
  linkHref,
  labelPrefix,
}: Props) {
  const { softActive, hardActive, hardThreshold, fireFlag } = counts;
  const totalActive = softActive + hardActive;

  const tone = fireFlag
    ? 'border-rose-400 bg-rose-100 text-rose-800 dark:bg-rose-950/30 dark:text-rose-200'
    : totalActive > 0
      ? 'border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950/20 dark:text-amber-200'
      : 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-200';

  const icon = fireFlag ? 'gpp_bad' : totalActive > 0 ? 'campaign' : 'check_circle';

  const text =
    totalActive === 0
      ? labelPrefix ?? 'No active warnings'
      : `${labelPrefix ? `${labelPrefix}: ` : ''}${softActive} soft · ${hardActive}/${hardThreshold} hard`;

  const body = (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-medium ${tone}`}
    >
      <Icon name={icon} size="xs" />
      {text}
    </span>
  );

  if (linkHref) {
    return (
      <Link href={linkHref} className="inline-flex hover:opacity-90">
        {body}
      </Link>
    );
  }
  return body;
}
