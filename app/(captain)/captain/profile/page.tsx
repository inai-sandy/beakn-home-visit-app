export const dynamic = "force-dynamic";

// HVA-78 stub. Captain profile + Change Password (HVA-29 form moves here)
// + dual-hat switcher (HVA-102, filed during HVA-78). Phase-1 captain
// dashboard does NOT include a logout trigger in the sidebar — logout
// lives on Profile per HVA-28's deferred-host comment, so this page is
// where /dev/logout-test's LogoutTrigger lifts in next.
export default function CaptainProfilePage() {
  return (
    <div className="p-4 sm:p-8 space-y-3 max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
      <p className="text-sm text-muted-foreground">
        Coming soon. Will host Change Password (HVA-29 lifts here from
        /dev/change-password-test), the dual-hat switcher (HVA-102), and
        the Logout trigger (HVA-28 lifts here from /dev/logout-test).
      </p>
    </div>
  );
}
