import { Icon } from '@/components/ui/icon';

// =============================================================================
// HVA-235 (HVA-231 Phase 1.1): Support team — Queue (placeholder)
// =============================================================================
//
// Empty-state page. The actual queue lands in HVA-231 Phase 2 with the
// dispatch action UI + multi-table layout. For now this gives the
// support role somewhere to log into.
// =============================================================================

export const metadata = {
  title: 'Queue — Support — Beakn',
};

export default function SupportQueuePage() {
  return (
    <section className="space-y-4">
      <header>
        <h2 className="text-2xl font-semibold tracking-tight">Dispatch queue</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Orders confirmed and awaiting dispatch will land here.
        </p>
      </header>

      <div className="rounded-3xl border bg-muted/40 p-10 text-center space-y-3">
        <Icon
          name="inventory_2"
          size="lg"
          className="text-muted-foreground/70 mx-auto"
        />
        <p className="text-sm text-muted-foreground">
          The dispatch workflow is shipping in HVA-231 Phase 2.
        </p>
        <p className="text-xs text-muted-foreground/80">
          For now this portal proves the role + auth + navigation work
          end-to-end. Once Phase 2 lands you&apos;ll see a multi-table queue
          here with priority sorting + dispatch actions.
        </p>
      </div>
    </section>
  );
}
