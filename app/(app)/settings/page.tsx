import { Suspense } from "react";
import { requirePageSession } from "@/lib/auth/session";
import { getProfileSettings } from "@/features/settings/queries";
import { ProfileSettings } from "@/features/settings/components/profile-settings";
import { SettingsSkeleton } from "@/features/settings/components/settings-shell";

async function SettingsContent() {
  await requirePageSession("/settings");
  return <ProfileSettings data={await getProfileSettings()} />;
}
export default function SettingsPage() {
  return (
    <Suspense fallback={<SettingsSkeleton tab="profile" />}>
      <SettingsContent />
    </Suspense>
  );
}
