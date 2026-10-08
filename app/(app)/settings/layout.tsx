import { Suspense, type ReactNode } from "react";
import {
  SettingsTabs,
  SettingsTabLinks,
} from "@/features/settings/components/settings-tabs";

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[1120px] space-y-6 px-4 py-6 md:px-8">
      <h1 className="text-[26px] font-bold tracking-tight">설정</h1>
      <Suspense fallback={<SettingsTabLinks />}>
        <SettingsTabs />
      </Suspense>
      {children}
    </div>
  );
}
