import { LeadAvatar } from '@/components/leads/LeadAvatar';
import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/utils';

// =============================================================================
// HVA-154: per-exec row on /captain/team
// =============================================================================
//
// Layout:
//
//   [Avatar]  Full Name [⚑ N overdue]            [Unavailable today]
//             +91 99876 54321  [📞]
//             5 active · 12 captured · 3 overdue
//
// NOT a Link — D1 says no drill-down. Just a flat read-only card.
// Phone affordance is the tel: link only (WhatsApp dropped per the
// adjustment; no WhatsApp brand asset, and the Material Symbols `chat`
// glyph is too ambiguous to repurpose).
//
// Red-flag visual matches the dashboard's ExecStatusRow verbatim:
// destructive Badge with ⚑ glyph and the overdue count. Keeps the two
// surfaces in lockstep.
// =============================================================================

export interface TeamMember {
  userId: string;
  fullName: string;
  phone: string;
  /** From sales_executives.is_unavailable */
  isUnavailable: boolean;
  hasRedFlag: boolean;
  overdueTaskCount: number;
  activeRequestCount: number;
  contactsCapturedInWindow: number;
}

interface Props {
  member: TeamMember;
}

export function TeamMemberCard({ member }: Props) {
  const phoneDigits = member.phone.replace(/\D/g, '');
  const phoneOk = phoneDigits.length >= 10;

  return (
    <article
      className={cn(
        'flex items-start gap-3 rounded-lg border bg-card px-3 py-2.5 shadow-sm',
        member.isUnavailable && 'opacity-80',
      )}
      aria-label={`Team member ${member.fullName}`}
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

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono">{member.phone}</span>
          {phoneOk && (
            <a
              href={`tel:${member.phone}`}
              aria-label={`Call ${member.fullName}`}
              className="inline-flex items-center justify-center size-7 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Icon name="phone" size="xs" />
            </a>
          )}
        </div>

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
    </article>
  );
}
