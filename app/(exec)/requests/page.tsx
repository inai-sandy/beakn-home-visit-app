import type { Metadata } from "next";

import { Icon } from "@/components/ui/icon";

// =============================================================================
// HVA-115: /requests stub
// =============================================================================
//
// Placeholder destination for the bottom-nav "Requests" slot. The real
// implementation lands in HVA-118 (exec requests list view). This file
// exists ONLY so the nav link doesn't 404; do not invest UX effort here.
// =============================================================================

export const metadata: Metadata = {
  title: "Requests — Beakn",
};

export default function ExecRequestsStubPage() {
  return (
    <main className="min-h-[60svh] flex items-center justify-center p-6">
      <div className="text-center space-y-3 max-w-sm">
        <Icon
          name="list_alt"
          size="lg"
          className="text-muted-foreground/70 mx-auto"
        />
        <h2 className="text-lg font-semibold tracking-tight">
          Requests list — coming soon
        </h2>
        <p className="text-sm text-muted-foreground">
          HVA-118 will replace this stub with the full requests view.
        </p>
      </div>
    </main>
  );
}
