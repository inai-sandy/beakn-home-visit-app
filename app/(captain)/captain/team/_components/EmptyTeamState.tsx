import { Icon } from '@/components/ui/icon';

// =============================================================================
// HVA-154: empty state when a captain has zero active execs on their team.
// =============================================================================

export function EmptyTeamState() {
  return (
    <div className="rounded-3xl border bg-muted/40 p-10 text-center space-y-3">
      <Icon
        name="groups"
        size="lg"
        className="text-muted-foreground/70 mx-auto"
      />
      <p className="text-sm text-muted-foreground">
        No active sales executives on your team yet.
      </p>
    </div>
  );
}
