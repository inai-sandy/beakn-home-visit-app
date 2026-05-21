import { Icon } from '@/components/ui/icon';

// =============================================================================
// HVA-167: AI Daily Report Card — static placeholder
// =============================================================================
//
// Matches the exec-side placeholder pattern (the same "coming in Phase
// 3" line shows up at the bottom of /today/close). Pure presentation.
// =============================================================================

export function AIDailyReportCard() {
  return (
    <section
      aria-label="AI insights"
      className="rounded-2xl border bg-muted/30 p-4 space-y-2"
    >
      <div className="flex items-center gap-2">
        <Icon name="auto_awesome" size="sm" className="text-muted-foreground" />
        <h2 className="text-sm font-semibold tracking-tight">AI Insights</h2>
      </div>
      <p className="text-xs text-muted-foreground">
        Daily performance analysis and coaching suggestions coming in Phase 3.
      </p>
    </section>
  );
}
