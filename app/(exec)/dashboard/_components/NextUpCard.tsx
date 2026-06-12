import Link from 'next/link';

import { Icon } from '@/components/ui/icon';
import type {
  ExecDashboardBannerState,
  ExecDashboardTaskRow,
} from '@/lib/exec/dashboard-queries';

import { AsOfNowTag } from './AsOfNowTag';

// =============================================================================
// HVA-277: "What's next?" — the single most-relevant live item
// =============================================================================
//
// Replaces the old StatusBanner + HeroMetrics pair. One card, one
// answer: what should I do right now? Day-state drives the message;
// the first pending task (the same ordering /today uses) is the
// suggestion. Always-now — wears the AsOfNowTag.
// =============================================================================

interface Props {
  banner: ExecDashboardBannerState;
  nextTask: ExecDashboardTaskRow | null;
}

function bodyFor(banner: ExecDashboardBannerState, nextTask: ExecDashboardTaskRow | null) {
  if (banner.kind === 'no_plan') {
    return {
      headline: 'Day not started',
      detail: 'Submit today’s plan to start the loop.',
      cta: { href: '/today', label: 'Start your day' },
    };
  }
  if (banner.kind === 'closed') {
    return {
      headline: 'Day closed',
      detail: 'Nothing more scheduled for today. See you tomorrow.',
      cta: { href: '/today', label: 'View today' },
    };
  }
  if (nextTask) {
    return {
      headline: nextTask.description || nextTask.taskType,
      detail: `${nextTask.taskType} · est. ${nextTask.estimatedTime}`,
      cta: { href: '/today', label: 'Open in Today' },
    };
  }
  return {
    headline: 'All caught up',
    detail:
      banner.kind === 'closeable'
        ? `Every task is decided — you can close the day (window opens ${banner.closeWindowHHMM}).`
        : 'No pending tasks right now.',
    cta: { href: '/today', label: 'View today' },
  };
}

export function NextUpCard({ banner, nextTask }: Props) {
  const body = bodyFor(banner, nextTask);
  const counts =
    banner.kind === 'in_progress'
      ? { pending: banner.pending, done: banner.done, postponed: banner.postponed }
      : null;

  return (
    <section className="rounded-2xl border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-tight text-muted-foreground">
          What’s next?
        </h2>
        <AsOfNowTag />
      </div>
      <div className="min-w-0">
        <p className="text-lg font-semibold tracking-tight leading-snug">
          {body.headline}
        </p>
        <p className="text-sm text-muted-foreground mt-0.5">{body.detail}</p>
      </div>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <Link
          href={body.cta.href}
          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          {body.cta.label}
          <Icon name="arrow_forward" size="xs" />
        </Link>
        {counts && (
          <p className="text-xs text-muted-foreground">
            Today: {counts.done} done · {counts.pending} pending ·{' '}
            {counts.postponed} postponed
          </p>
        )}
      </div>
    </section>
  );
}
