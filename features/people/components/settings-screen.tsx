import type { UsernameSettings } from "../types";
import { UsernameForm, type SaveUsername } from "./username-form";

export function SettingsScreen({
  name,
  settings,
  action,
}: {
  name: string;
  settings: UsernameSettings;
  action?: SaveUsername;
}) {
  return (
    <section
      aria-labelledby="profile-heading"
      className="space-y-6 rounded-xl border border-border bg-card p-5 shadow-card"
    >
      <h2 id="profile-heading" className="font-semibold">
        프로필
      </h2>
      <div className="space-y-1">
        <p className="text-sm font-medium">이름</p>
        <p>{name}</p>
      </div>
      <UsernameForm
        key={`${settings.username}:${settings.nextChangeAt}`}
        settings={settings}
        action={action}
      />
    </section>
  );
}
