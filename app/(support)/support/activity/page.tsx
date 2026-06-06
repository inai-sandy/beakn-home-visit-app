import { Icon } from '@/components/ui/icon';

export const metadata = {
  title: 'Activity — Support — Beakn',
};

export default function SupportActivityPage() {
  return (
    <section className="space-y-4">
      <header>
        <h2 className="text-2xl font-semibold tracking-tight">Activity</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Recent dispatches across all orders.
        </p>
      </header>

      <div className="rounded-3xl border bg-muted/40 p-10 text-center space-y-3">
        <Icon
          name="history"
          size="lg"
          className="text-muted-foreground/70 mx-auto"
        />
        <p className="text-sm text-muted-foreground">
          Coming in HVA-231 Phase 2.
        </p>
      </div>
    </section>
  );
}
