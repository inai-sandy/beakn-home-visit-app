"use client";

import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useMediaQuery } from "@/lib/hooks/use-media-query";

// =============================================================================
// HVA-28: Logout confirmation modal
// =============================================================================
//
// Responsive shell mirrors HVA-27's ForgotPasswordModal:
//   - Dialog (centered, 24dp rounded) on viewports ≥768px
//   - Sheet (slide-up bottom sheet, 24dp top corners) below
// Both are shadcn primitives wrapping Radix, so the focus trap, scrim
// click-out, Escape key, and return-focus-on-close come from Radix natively.
//
// AC #1 ("modal blocks accidental taps") is satisfied by requiring an
// explicit tap on the destructive Logout button. Tapping the scrim, the
// Cancel button, or Escape just dismisses — no action fires.
// =============================================================================

interface LogoutConfirmationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Server Action that performs the actual logout. Receives no arguments
   * because the action reads everything it needs from request headers
   * (session cookie, user-agent, forwarded IP). On success it `redirect()`s
   * server-side, so the awaited promise never resolves on the happy path —
   * the browser navigates away while the request is still in flight.
   */
  onConfirm: () => Promise<void>;
}

function ModalBody({
  onCancel,
  onConfirm,
  pending,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  return (
    <>
      <p className="text-sm text-muted-foreground">
        You&apos;ll need to sign in again.
      </p>

      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
        <Button
          variant="outline"
          onClick={onCancel}
          disabled={pending}
          className="w-full sm:w-auto h-12 sm:h-10"
        >
          Cancel
        </Button>
        <Button
          variant="destructive"
          onClick={onConfirm}
          disabled={pending}
          className="w-full sm:w-auto h-12 sm:h-10"
        >
          {pending ? (
            <>
              <Icon name="progress_activity" size="sm" className="animate-spin" />
              <span>Signing out…</span>
            </>
          ) : (
            "Logout"
          )}
        </Button>
      </div>
    </>
  );
}

export function LogoutConfirmationModal({
  open,
  onOpenChange,
  onConfirm,
}: LogoutConfirmationModalProps) {
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const [pending, startTransition] = useTransition();

  const headline = "Logout?";
  const description = "You'll need to sign in again.";

  const onCancel = () => {
    if (pending) return;
    onOpenChange(false);
  };

  const handleConfirm = () => {
    // useTransition lets us reflect a "signing out…" state without blocking
    // the React renderer. The Server Action will redirect() before the
    // promise resolves, so the unmount happens mid-transition.
    startTransition(async () => {
      await onConfirm();
    });
  };

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md rounded-3xl">
          <DialogHeader>
            <DialogTitle>{headline}</DialogTitle>
            <DialogDescription className="sr-only">
              {description}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <ModalBody
              onCancel={onCancel}
              onConfirm={handleConfirm}
              pending={pending}
            />
          </div>
          <DialogFooter className="hidden" />
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-3xl pb-8">
        <SheetHeader className="text-left">
          <SheetTitle>{headline}</SheetTitle>
          <SheetDescription className="sr-only">{description}</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 px-4">
          <ModalBody
            onCancel={onCancel}
            onConfirm={handleConfirm}
            pending={pending}
          />
        </div>
        <SheetFooter className="hidden" />
      </SheetContent>
    </Sheet>
  );
}
