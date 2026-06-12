import type { ReactNode } from 'react';

import { BackButton } from '@/components/ui/back-button';
import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';

// =============================================================================
// HVA-243: sticky header for /requests/[id]
// =============================================================================
//
// Top row: BackButton + customer name (truncated) + Edit pencil (when
//   editable) + optional inline primary CTA on desktop.
// Second row: status badge + city + phone CTA + primary CTA on mobile.
//
// `primaryAction` is the single most-important verb resolved by
// computeActionVisibility (priority: approve > markComplete > advance >
// assignExec). All other verbs live in the Admin tab.
// =============================================================================

interface Props {
  customerName: string;
  customerPhone: string;
  cityName: string;
  statusBadge: ReactNode;
  backFallback: string;
  primaryAction?: ReactNode;
  editButton?: ReactNode;
  /**
   * HVA-252: badge identifying the source of the request. Currently set
   * only for portal-origin (CartPlus) requests; manual entries leave this
   * undefined and the badge slot is hidden.
   */
  sourceBadge?: ReactNode;
}

export function StickyRequestHeader({
  customerName,
  customerPhone,
  cityName,
  statusBadge,
  backFallback,
  primaryAction,
  editButton,
  sourceBadge,
}: Props) {
  return (
    <header className="sticky top-0 z-20 bg-background/95 backdrop-blur border-b">
      <div className="mx-auto max-w-2xl px-4 sm:px-6 py-2 space-y-2">
        <div className="flex items-center gap-3">
          <BackButton
            fallback={backFallback}
            size="icon"
            className="h-11 w-11 shrink-0"
          />
          <div className="flex-1 min-w-0">
            <p className="text-base font-semibold tracking-tight truncate">
              {customerName}
            </p>
            <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
              {statusBadge}
              <Badge variant="outline" className="text-[10px]">
                {cityName}
              </Badge>
              {/* HVA-274: the phone used to be a full-size button row that
                  dominated the header. Sandeep 2026-06-12: shrink it to
                  city-badge scale. Still one tap to call. */}
              <a
                href={`tel:${customerPhone}`}
                aria-label={`Call ${customerName}`}
                className="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-mono text-foreground hover:bg-muted transition-colors"
              >
                <Icon name="phone" size="xs" />
                {customerPhone}
              </a>
              {sourceBadge}
            </div>
          </div>
          {editButton}
        </div>
        {primaryAction && (
          <div className="flex items-center gap-2 flex-wrap">
            {primaryAction}
          </div>
        )}
      </div>
    </header>
  );
}
