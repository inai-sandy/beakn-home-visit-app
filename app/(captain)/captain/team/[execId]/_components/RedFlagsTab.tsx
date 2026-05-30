import { Icon } from '@/components/ui/icon';

// HVA-83: Red Flags tab — Phase 3 placeholder per spec.

export function RedFlagsTab() {
  return (
    <div className="rounded-2xl border bg-card p-8 text-center space-y-3">
      <Icon
        name="flag"
        size="lg"
        className="text-muted-foreground/60 mx-auto"
      />
      <div className="space-y-1">
        <p className="text-base font-semibold tracking-tight">
          Red Flags — coming in Phase 3
        </p>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          AI-detected anomalies (fast-completion patterns, late-day-plan
          submissions, unusual postpone rates, etc.) will surface here once
          the AI Report Card pipeline ships.
        </p>
      </div>
    </div>
  );
}
