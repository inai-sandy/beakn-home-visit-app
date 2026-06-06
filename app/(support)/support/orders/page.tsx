import { Icon } from '@/components/ui/icon';

export const metadata = {
  title: 'Orders — Support — Beakn',
};

export default function SupportOrdersPage() {
  return (
    <section className="space-y-4">
      <header>
        <h2 className="text-2xl font-semibold tracking-tight">Orders</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Full order detail + dispatch history per request.
        </p>
      </header>

      <div className="rounded-3xl border bg-muted/40 p-10 text-center space-y-3">
        <Icon
          name="receipt_long"
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
