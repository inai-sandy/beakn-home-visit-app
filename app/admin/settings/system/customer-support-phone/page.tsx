import { redirect } from "next/navigation";

import { getServerSession } from "@/lib/auth-server";
import { getConfig } from "@/lib/config";

import { CustomerSupportPhoneClient } from "./customer-support-phone-client";

// =============================================================================
// HVA-105 (extended): /admin/settings/system/customer-support-phone
// =============================================================================
//
// Single-config-key admin editor. The /track/[token] page (HVA-36) reads
// this value at every render via getConfig; admin sets it here.
//
// super_admin only. Captain or sales_exec hits hit the role-home redirect.
// Anonymous redirected to /login.
//
// Visual pattern mirrors /admin/settings/organization/cities (HVA-110):
// single-card row + Edit button → Dialog → input → save → router.refresh.
// =============================================================================

export const dynamic = "force-dynamic";

export default async function CustomerSupportPhoneAdminPage() {
  const session = await getServerSession();
  if (!session) {
    redirect("/login?next=/admin/settings/system/customer-support-phone");
  }
  const user = session.user as { id: string; role?: string };
  if (user.role !== "super_admin") redirect("/admin/dashboard");

  const currentValue = await getConfig("customer_support_phone");

  return (
    <main className="min-h-svh bg-background">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Customer support phone
          </h1>
          <p className="text-sm text-muted-foreground">
            Shown on the public tracking page footer and in customer-facing
            notifications. Blank value falls back to a placeholder with a
            visible &ldquo;Demo number&rdquo; notice.
          </p>
        </header>

        <CustomerSupportPhoneClient currentValue={currentValue} />
      </div>
    </main>
  );
}
