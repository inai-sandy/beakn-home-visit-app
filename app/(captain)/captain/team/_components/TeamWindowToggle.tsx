import Link from 'next/link';

import { cn } from '@/lib/utils';

// =============================================================================
// HVA-154: Today / This Week / This Month toggle for /captain/team
// =============================================================================
//
// Three server-rendered <Link>s styled like the existing bucket tabs on
// /captain/requests. Active state set via `aria-current="page"`. No
// count chip (unlike RequestBucketTabs) — the toggle just sets the
// window, the counts live inside each TeamMemberCard.
//
// Kept as a small dedicated component rather than generalising
// RequestBucketTabs because: (a) no count chip, (b) only ever 3
// options, (c) clearer for future maintainers.
// =============================================================================

export type TeamWindow = 'today' | 'week' | 'month';

interface Props {
  active: TeamWindow;
  /** Path the toggle writes to. Defaults to /captain/team; admin
   *  portal passes /admin/portal/<captainId>/team. */
  basePath?: string;
}

const OPTIONS: ReadonlyArray<{ key: TeamWindow; label: string }> = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
];

export function TeamWindowToggle({ active, basePath = '/captain/team' }: Props) {
  return (
    <nav
      aria-label="Date window"
      className="flex flex-wrap gap-1.5"
    >
      {OPTIONS.map((opt) => {
        const isActive = opt.key === active;
        // 'week' is the default — drop the query param when selecting it
        // so the canonical URL stays clean.
        const href =
          opt.key === 'week' ? basePath : `${basePath}?window=${opt.key}`;
        return (
          <Link
            key={opt.key}
            href={href}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              isActive
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-muted-foreground/20 text-muted-foreground hover:bg-muted/60 hover:text-foreground',
            )}
          >
            {opt.label}
          </Link>
        );
      })}
    </nav>
  );
}
