import { Suspense } from "react";
import { requirePageSession } from "@/lib/auth/session";
import { getPreferences } from "@/features/settings/queries";
import { PreferenceSettings } from "@/features/settings/components/preference-settings";
import { SettingsSkeleton } from "@/features/settings/components/settings-shell";

async function Content() {
  await requirePageSession("/settings/preferences");
  return <PreferenceSettings data={await getPreferences()} />;
}
export default function PreferenceSettingsPage() {
  return (
    <Suspense fallback={<SettingsSkeleton tab="preferences" />}>
      <Content />
    </Suspense>
  );
}
