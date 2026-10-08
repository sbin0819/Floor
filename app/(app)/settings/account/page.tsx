import { Suspense } from "react";
import { requirePageSession } from "@/lib/auth/session";
import { getAccountSettings } from "@/features/settings/queries";
import { AccountSettings } from "@/features/settings/components/account-settings";
import { SettingsSkeleton } from "@/features/settings/components/settings-shell";

async function Content() {
  await requirePageSession("/settings/account");
  return <AccountSettings data={await getAccountSettings()} />;
}
export default function AccountSettingsPage() {
  return (
    <Suspense fallback={<SettingsSkeleton tab="account" />}>
      <Content />
    </Suspense>
  );
}
