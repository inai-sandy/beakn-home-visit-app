import Link from 'next/link';

import { LeadAvatar } from '@/components/leads/LeadAvatar';
import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/utils';

// =============================================================================
// HVA-166: unified contact card — used by both the exec /leads list and
// the captain /captain/contacts list.
// =============================================================================
//
// Replaces two parallel row files (LeadCard.tsx, CaptainContactRow.tsx)
// that previously split the layout by converted state — converted rows
// got a chevron, unconverted rows got a WhatsApp/Mail/Phone cluster.
// That split inverted the value (rows with a request need quick contact
// affordances *more*, not less) and crammed the middle column past its
// available width on real devices.
//
// New layout (mobile + desktop):
//   - Avatar circle (40dp), name (truncate), chevron-right
//   - City · Customer|Business chip · "N request(s)" / "No requests" chip
//   - "Captured by <name>" subline
//   - Whole card is a real <Link> (no div+onClick gymnastics — the
//     action icons were the only reason for stopPropagation, and
//     they're gone now)
//
// Detail-page action affordances (WhatsApp / Email / Phone) are
// untouched — they live on /leads/[id] and /captain/contacts/[id]
// already. Removing them from the *list* row only.
// =============================================================================

export interface ContactCardProps {
  id: string;
  name: string;
  type: string; // 'Customer' | 'Business' | unknown future
  cityName: string;
  capturedByName: string | null;
  requestCount: number;
  /** Visual cue for the converted state (slightly muted name). */
  converted?: boolean;
  /** Route prefix — '/leads' (exec) or '/captain/contacts' (captain). */
  hrefPrefix: '/leads' | '/captain/contacts';
}

function requestCountLabel(n: number): string {
  if (n === 0) return 'No requests';
  if (n === 1) return '1 request';
  return `${n} requests`;
}

export function ContactCard({
  id,
  name,
  type,
  cityName,
  capturedByName,
  requestCount,
  converted = false,
  hrefPrefix,
}: ContactCardProps) {
  const isBusiness = type === 'Business';

  return (
    <Link
      href={`${hrefPrefix}/${id}`}
      aria-label={`${name}${converted ? ' — converted' : ''}`}
      className={cn(
        'flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5 shadow-sm',
        'transition-colors hover:bg-accent/40 active:bg-accent',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        converted && 'opacity-80',
      )}
    >
      <LeadAvatar name={name} aria-hidden />

      <div className="min-w-0 flex-1 space-y-0.5">
        <p
          className={cn(
            'truncate text-base font-semibold tracking-tight',
            converted && 'text-muted-foreground',
          )}
        >
          {name}
        </p>
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span className="truncate max-w-[10rem]">{cityName}</span>
          <span aria-hidden>·</span>
          <Badge
            variant={isBusiness ? 'default' : 'secondary'}
            className="text-[10px] px-1.5 py-0"
          >
            {type}
          </Badge>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
            {requestCountLabel(requestCount)}
          </Badge>
        </div>
        <p className="text-[11px] text-muted-foreground/80 truncate">
          Captured by{' '}
          <span className="font-medium">{capturedByName ?? '—'}</span>
        </p>
      </div>

      <Icon
        name="chevron_right"
        size="sm"
        className="shrink-0 text-muted-foreground"
        aria-hidden
      />
    </Link>
  );
}
