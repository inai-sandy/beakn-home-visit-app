"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ForgotPasswordModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Placeholder for HVA-23. The full Call-Admin flow (live admin support
// phone fetched via lib/config getConfig('admin_support_phone'), tel: link,
// audit log entry for the request) is HVA-27.
//
// Why we can't just call getConfig() from here: this is a Client Component
// and the config service runs server-side. HVA-27 will replace the static
// copy below with either a Server Component child or a server action that
// returns the phone number on demand.
export function ForgotPasswordModal({ open, onOpenChange }: ForgotPasswordModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md rounded-3xl">
        <DialogHeader>
          <DialogTitle>Forgot your password?</DialogTitle>
          <DialogDescription>
            Contact your administrator to reset your password.
          </DialogDescription>
        </DialogHeader>

        <div className="text-sm text-muted-foreground">
          <p>
            The live admin support phone number will appear here once HVA-27
            wires the Call-Admin flow to the <code>admin_support_phone</code>{" "}
            config key (seeded in HVA-17).
          </p>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="w-full sm:w-auto"
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
