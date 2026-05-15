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

interface ForgotPasswordModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Raw admin support phone string read server-side from the `config` table
   * (`admin_support_phone` key, HVA-17). Passed in as a prop — the modal
   * itself never touches the config service. Empty string is treated as
   * "not configured" and renders the graceful fallback.
   */
  adminPhone: string;
}

// Build a tel: href from whatever shape the admin stored:
//   "+91 99999 99999"  → tel:+919999999999
//   "9999999999"       → tel:+9999999999  (no +91 prefix added — admin's responsibility)
//   ""                 → null  (no link)
// Strips spaces, dashes, parens, dots. Ensures leading +. Returns null if the
// result is too short to be a real phone (defensive against junk in DB).
function buildTelHref(raw: string): string | null {
  if (!raw) return null;
  let cleaned = raw.replace(/[^\d+]/g, "");
  if (!cleaned) return null;
  if (!cleaned.startsWith("+")) cleaned = "+" + cleaned;
  if (cleaned.length < 8) return null;
  return cleaned;
}

// Display formatter. Indian +91 numbers get "+91 XXXXX XXXXX" spacing;
// anything else passes through verbatim so admins can use whatever convention
// the config row carries.
function formatPhoneForDisplay(raw: string): string {
  const cleaned = raw.replace(/[^\d+]/g, "");
  if (cleaned.startsWith("+91") && cleaned.length === 13) {
    return `+91 ${cleaned.slice(3, 8)} ${cleaned.slice(8)}`;
  }
  return raw;
}

// Modal content is shared between the Dialog (desktop) and Sheet (mobile)
// variants — keeping the JSX in one place keeps the two paths in sync.
function ModalBody({
  adminPhone,
  onClose,
}: {
  adminPhone: string;
  onClose: () => void;
}) {
  const telHref = buildTelHref(adminPhone);
  const display = formatPhoneForDisplay(adminPhone);

  return (
    <>
      {telHref ? (
        <>
          <p className="text-sm text-muted-foreground">
            Contact your administrator to reset your password.
          </p>
          <div className="rounded-2xl border bg-muted/40 p-4 text-center">
            <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
              Admin support
            </p>
            <p className="text-base font-semibold tracking-tight">{display}</p>
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          Please contact your administrator to reset your password.
        </p>
      )}

      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
        <Button
          variant="outline"
          onClick={onClose}
          className="w-full sm:w-auto h-12 sm:h-10"
        >
          Close
        </Button>
        {telHref && (
          <Button asChild className="w-full sm:w-auto h-12 sm:h-10">
            <a href={`tel:${telHref}`} aria-label={`Call admin at ${display}`}>
              <Icon name="call" size="sm" />
              <span>Call Admin</span>
            </a>
          </Button>
        )}
      </div>
    </>
  );
}

// Responsive modal: Sheet (slide-up bottom sheet) on mobile, Dialog (centered)
// on desktop. shadcn primitives wrap Radix, so all three close methods (button,
// scrim/outside click, Escape) and focus trap + return-focus-on-close come
// from Radix natively for both variants.
export function ForgotPasswordModal({
  open,
  onOpenChange,
  adminPhone,
}: ForgotPasswordModalProps) {
  const isDesktop = useMediaQuery("(min-width: 768px)");

  const headline = "Forgot your password?";
  const onClose = () => onOpenChange(false);

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md rounded-3xl">
          <DialogHeader>
            <DialogTitle>{headline}</DialogTitle>
            <DialogDescription className="sr-only">
              Contact your administrator to reset your password.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <ModalBody adminPhone={adminPhone} onClose={onClose} />
          </div>
          <DialogFooter className="hidden" />
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-3xl pb-8"
      >
        <SheetHeader className="text-left">
          <SheetTitle>{headline}</SheetTitle>
          <SheetDescription className="sr-only">
            Contact your administrator to reset your password.
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-4 px-4">
          <ModalBody adminPhone={adminPhone} onClose={onClose} />
        </div>
        <SheetFooter className="hidden" />
      </SheetContent>
    </Sheet>
  );
}
