'use client';

import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Icon } from '@/components/ui/icon';
import { logoutAction } from '@/lib/auth/logout-action';

// HVA-76: Logout entry point on the profile page. Reuses the existing
// HVA-28 server action; only adds the confirmation modal in front of it
// (the action itself was already wired without a modal — this lifts the
// HVA-28 spec from "/dev/logout-test direct button" to the real
// "confirm before signing out" UX).

export function LogoutCard() {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <div className="rounded-2xl border bg-card p-5 space-y-3">
      <div className="flex items-center gap-2">
        <Icon name="logout" size="sm" className="text-destructive" />
        <h2 className="text-base font-semibold tracking-tight">Sign out</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        You'll need to sign in again on this device.
      </p>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="destructive" className="h-11 px-5">
            Sign out
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sign out?</DialogTitle>
            <DialogDescription>
              You'll need to sign in again to come back.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={pending}
              onClick={() => startTransition(() => logoutAction())}
            >
              {pending ? 'Signing out…' : 'Sign out'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
