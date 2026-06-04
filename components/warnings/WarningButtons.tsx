'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';

import { IssueWarningDialog } from './IssueWarningDialog';

// =============================================================================
// HVA-228: WarningButtons — the soft + hard button pair
// =============================================================================
//
// Drops into any admin row (targets page, exec detail page). Renders
// two outlined buttons; clicking opens the IssueWarningDialog with
// the right `kind` pre-set. Caller passes the current hard count so
// the dialog can show "N+1/5".
//
// Size variants:
//   - `compact` — for table-row use (icon + short label)
//   - `default` — for the exec detail / dashboard pages
// =============================================================================

interface Props {
  execUserId: string;
  execName: string;
  captainName: string | null;
  currentHardCount: number;
  variant?: 'default' | 'compact';
}

export function WarningButtons({
  execUserId,
  execName,
  captainName,
  currentHardCount,
  variant = 'default',
}: Props) {
  const [openKind, setOpenKind] = useState<'soft' | 'hard' | null>(null);

  const isCompact = variant === 'compact';
  const sizeClass = isCompact ? 'h-8 text-[11px]' : 'h-9 text-xs';

  return (
    <>
      <div className="flex items-center gap-1.5 flex-wrap">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setOpenKind('soft')}
          className={`${sizeClass} border-amber-300 text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950/20`}
        >
          <Icon name="campaign" size="xs" />
          {isCompact ? 'Soft' : 'Soft warning'}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setOpenKind('hard')}
          className={`${sizeClass} border-rose-300 text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/20`}
        >
          <Icon name="gpp_bad" size="xs" />
          {isCompact ? 'Hard' : 'Hard warning'}
        </Button>
      </div>

      {openKind && (
        <IssueWarningDialog
          open
          onClose={() => setOpenKind(null)}
          kind={openKind}
          execUserId={execUserId}
          execName={execName}
          captainName={captainName}
          currentHardCount={currentHardCount}
        />
      )}
    </>
  );
}
