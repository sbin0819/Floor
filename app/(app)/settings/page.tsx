import { Suspense } from "react";
import { requirePageSession } from "@/lib/auth/session";
import { getUsernameSettings } from "@/features/people/queries";
import { SettingsScreen } from "@/features/people/components/settings-screen";
import {
  PeopleShell,
  PeopleSkeleton,
} from "@/features/people/components/people-shell";

async function SettingsContent() {
  const session = await requirePageSession("/settings");
  return (
    <SettingsScreen
      name={session.name}
      settings={await getUsernameSettings()}
    />
  );
}
export default function SettingsPage() {
  return (
    <PeopleShell title="설정">
      <Suspense fallback={<PeopleSkeleton settings />}>
        <SettingsContent />
      </Suspense>
    </PeopleShell>
  );
}
