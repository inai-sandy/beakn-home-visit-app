"use client";

import { Bell, MoreHorizontal, User } from "lucide-react";
import { toast } from "sonner";

import { ThemeToggle } from "@/components/theme-toggle";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// Renders every shadcn primitive added in HVA-12 so we can eyeball the M3
// scheme + radius scale (16/20/12/24dp) in both light and dark mode.
export default function ThemeTestPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 p-6 sm:p-10">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Beakn — M3 theme test
          </h1>
          <p className="text-sm text-muted-foreground">
            Seed <code className="font-mono">#0F766E</code> (Deep Teal). Toggle
            light/dark to verify both schemes.
          </p>
        </div>
        <ThemeToggle />
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Buttons (16dp radius)</CardTitle>
          <CardDescription>
            All shadcn variants on the M3 primary scale.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="link">Link</Button>
          <Button size="icon" aria-label="Notifications">
            <Bell />
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Inputs (12dp radius)</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Input placeholder="Customer name" />
          <Input placeholder="Phone number" type="tel" />
          <Input placeholder="Disabled" disabled />
          <Input placeholder="Error" aria-invalid />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tabs, Switch &amp; Badges</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="visits">Visits</TabsTrigger>
              <TabsTrigger value="customers">Customers</TabsTrigger>
            </TabsList>
            <TabsContent value="overview" className="text-sm">
              Active tab paints with primary container; inactive tabs sit on
              surface.
            </TabsContent>
            <TabsContent value="visits" className="text-sm">
              Field visit list goes here.
            </TabsContent>
            <TabsContent value="customers" className="text-sm">
              Customer directory goes here.
            </TabsContent>
          </Tabs>

          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-3">
              <Switch id="notify" defaultChecked />
              <label htmlFor="notify" className="text-sm">
                Push notifications
              </label>
            </div>
            <Badge>Confirmed</Badge>
            <Badge variant="secondary">Scheduled</Badge>
            <Badge variant="destructive">Cancelled</Badge>
            <Badge variant="outline">Draft</Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Avatar &amp; DropdownMenu</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-4">
          <Avatar>
            <AvatarFallback>SK</AvatarFallback>
          </Avatar>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label="More">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>Account</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem>
                <User className="size-4" />
                Profile
              </DropdownMenuItem>
              <DropdownMenuItem>Settings</DropdownMenuItem>
              <DropdownMenuItem>Sign out</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="secondary"
            onClick={() =>
              toast.success("Toast (Sonner) wired", {
                description:
                  "Sonner replaces the deprecated shadcn Toast. M3 tokens applied.",
              })
            }
          >
            Fire toast
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Overlays — Dialog (24dp) &amp; Sheet</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Dialog>
            <DialogTrigger asChild>
              <Button>Open dialog</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Schedule home visit</DialogTitle>
                <DialogDescription>
                  Dialog uses the 24dp modal radius and surface tokens.
                </DialogDescription>
              </DialogHeader>
              <Input placeholder="Customer name" />
              <DialogFooter showCloseButton>
                <Button>Confirm</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline">Open sheet</Button>
            </SheetTrigger>
            <SheetContent side="right">
              <SheetHeader>
                <SheetTitle>Filters</SheetTitle>
                <SheetDescription>
                  Mobile-friendly side panel for field-ops filters.
                </SheetDescription>
              </SheetHeader>
            </SheetContent>
          </Sheet>
        </CardContent>
        <CardFooter className="border-t pt-6 text-xs text-muted-foreground">
          All surfaces above pull from the same M3 scheme — switch theme to
          verify.
        </CardFooter>
      </Card>
    </main>
  );
}
