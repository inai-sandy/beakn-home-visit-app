"use client";

import { toast } from "sonner";

import { Button } from "@/components/ui/button";

// =============================================================================
// HVA-30: placeholder submit button for /request
// =============================================================================
//
// Lives in its own client component because the parent page is a server
// component. Once HVA-31 lands the real Server Action + react-hook-form
// wiring, this whole file gets replaced by the form's own submit button
// inside the RequestForm client component.
//
// For now: tapping the button fires a Sonner info toast pointing at HVA-31
// so anyone exercising the page on production knows the submission isn't
// wired yet.
// =============================================================================

export function RequestSubmitButton() {
  return (
    <Button
      type="button"
      onClick={() => {
        toast.info("Form submission lands in HVA-31", {
          description:
            "This page is the layout shell. The submit handler ships with the field schema in the next issue.",
        });
      }}
      className="w-full h-14 sm:h-12 text-base font-medium"
    >
      Submit
    </Button>
  );
}
