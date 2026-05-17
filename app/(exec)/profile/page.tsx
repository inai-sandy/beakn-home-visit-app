import type { Metadata } from "next";

import { Icon } from "@/components/ui/icon";

// =============================================================================
// HVA-115: /profile stub
// =============================================================================
//
// Placeholder destination for the bottom-nav "Profile" slot + avatar
// menu's "Profile" item. The real implementation lands in HVA-76.
// =============================================================================

export const metadata: Metadata = {
  title: "Profile — Beakn",
};

export default function ExecProfileStubPage() {
  return (
    <main className="min-h-[60svh] flex items-center justify-center p-6">
      <div className="text-center space-y-3 max-w-sm">
        <Icon
          name="person"
          size="lg"
          className="text-muted-foreground/70 mx-auto"
        />
        <h2 className="text-lg font-semibold tracking-tight">
          Profile — coming soon
        </h2>
        <p className="text-sm text-muted-foreground">
          HVA-76 will replace this stub with the executive profile view.
        </p>
      </div>
    </main>
  );
}
