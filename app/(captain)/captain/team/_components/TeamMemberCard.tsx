import Link from 'next/link';

import { LeadAvatar } from '@/components/leads/LeadAvatar';
import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/utils';

// =============================================================================
// HVA-154 + HVA-167: per-exec row on /captain/team
// =============================================================================
//
// Layout:
//
//   [Avatar]  Full Name [⚑ N overdue]            [Unavailable today] [›]
//             +91 99876 54321
//             5 active · 12 captured · 3 overdue
//
// HVA-167: row is now a real <Link> to /captain/team/[execId]. The
// inline tel: button is gone — too noisy alongside Link wrapping
// (nested anchors are invalid HTML) and the drill-down header carries
// its own tel: affordance.
// =============================================================================

export interface TeamMember {
  userId: string;
  fullName: string;
  phone: string;
  isUnavailable: boolean;
  hasRedFlag: boolean;
  overdueTaskCount: number;
  activeRequestCount: number;
  contactsCapturedInWindow: number;
}

interface Props {
  member: TeamMember;
  /** Where the row links to. Defaults to /captain/team/<execId>; admin
   *  captain-portal passes /admin/portal/<captainId>/team. */
  basePath?: string;
}

export function TeamMemberCard({ member, basePath = '/captain/team' }: Props) {
  return (
    <Link
      href={`${basePath}/${member.userId}`}
      aria-label={`Open ${member.fullName}'s drill-down`}
      className={cn(
        'flex items-start gap-3 rounded-lg border bg-card px-3 py-2.5 shadow-sm',
        'transition-colors hover:bg-accent/40 active:bg-accent',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        member.isUnavailable && 'opacity-80',
      )}
    >
      <LeadAvatar name={member.fullName} aria-hidden />

      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <p className="truncate text-base font-semibold tracking-tight">
              {member.fullName}
            </p>
            {member.hasRedFlag && (
              <Badge variant="destructive" className="text-[10px] shrink-0">
                ⚑ {member.overdueTaskCount} overdue
              </Badge>
            )}
          </div>
          {member.isUnavailable && (
            <Badge variant="outline" className="text-[10px] shrink-0">
              Unavailable today
            </Badge>
          )}
        </div>

        <p className="text-xs text-muted-foreground font-mono">{member.phone}</p>

        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">
            {member.activeRequestCount}
          </span>{' '}
          active
          <span aria-hidden> · </span>
          <span className="font-medium text-foreground">
            {member.contactsCapturedInWindow}
          </span>{' '}
          captured
          <span aria-hidden> · </span>
          <span
            className={cn(
              'font-medium',
              member.overdueTaskCount > 0
                ? 'text-destructive'
                : 'text-foreground',
            )}
          >
            {member.overdueTaskCount}
          </span>{' '}
          overdue
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
