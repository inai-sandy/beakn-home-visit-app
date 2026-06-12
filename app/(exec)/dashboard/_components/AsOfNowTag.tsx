import { Icon } from '@/components/ui/icon';

// =============================================================================
// HVA-277: "as of now" tag
// =============================================================================
//
// The redesign's one-clock rule: every tile obeys the from/to picker.
// The few surfaces that only exist in the present (next task, pending
// work, approvals) wear this tag so they are never mistaken for
// historical data. Shared by all three portal redesigns.
// =============================================================================

export function AsOfNowTag() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      <Icon name="schedule" size="xs" />
      as of now
    </span>
  );
}
