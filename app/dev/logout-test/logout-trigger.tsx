"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

import { logoutAction } from "./actions";
import { LogoutConfirmationModal } from "./logout-confirmation-modal";

// =============================================================================
// HVA-28: Logout trigger (client wrapper)
// =============================================================================
//
// Pairs the destructive Logout button with the confirmation modal — the page
// is a Server Component so the open-state and the modal portal both have to
// live inside a client island. When the Profile screen ships in HVA-76, the
// same pair (button + LogoutConfirmationModal) can be lifted into that screen
// unchanged; this island is structured to be plug-and-play.
// =============================================================================

export function LogoutTrigger() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="destructive"
        onClick={() => setOpen(true)}
        className="w-full sm:w-auto h-12 sm:h-10"
      >
        <Icon name="logout" size="sm" />
        <span>Logout</span>
      </Button>

      <LogoutConfirmationModal
        open={open}
        onOpenChange={setOpen}
        onConfirm={logoutAction}
      />
    </>
  );
}
