import { Suspense, useState, type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProfileSettings } from "@/features/settings/components/profile-settings";
import { AccountSettings } from "@/features/settings/components/account-settings";
import { PreferenceSettings } from "@/features/settings/components/preference-settings";
import { SettingsTabLinks } from "@/features/settings/components/settings-tabs";
import type {
  ProfileSettings as ProfileData,
  AccountSettings as AccountData,
} from "@/features/settings/types";
import { SettingsSkeleton } from "@/features/settings/components/settings-shell";

function Frame({ children }: { children: ReactNode }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  return (
    <QueryClientProvider client={client}>
      <div className="mx-auto max-w-[1120px] space-y-6">
        <h1 className="text-[26px] font-bold">설정</h1>
        {children}
      </div>
    </QueryClientProvider>
  );
}
const profile: ProfileData = {
  userId: "11111111-1111-4111-8111-111111111111",
  name: "김하은",
  avatar: { color: "purple", photoUrl: null },
  photo: false,
  photoUrl: null,
  photoProvider: null,
  usernameSettings: {
    username: "haeun.kim",
    usernameChangedAt: null,
    nextChangeAt: null,
    now: "2026-10-09T00:00:00Z",
    suggestion: null,
  },
  preview: {
    userId: "11111111-1111-4111-8111-111111111111",
    name: "김하은",
    avatar: { color: "purple", photoUrl: null },
    username: "haeun.kim",
    isMe: true,
    relation: null,
    sharedSpaces: [{ id: "team", name: "가상 디자인팀" }],
    directRoomId: null,
    canDirectMessage: false,
  },
};
const account: AccountData = {
  email: "test1@ai.com",
  emailVerified: true,
  providers: ["credential", "google"],
  sessions: [
    {
      id: "current",
      browser: "Chrome",
      os: "macOS",
      device: "desktop",
      createdAt: "2026-10-01T00:00:00Z",
      updatedAt: "2026-10-09T00:00:00Z",
      current: true,
    },
    {
      id: "phone",
      browser: "Safari",
      os: "iOS",
      device: "mobile",
      createdAt: "2026-10-02T00:00:00Z",
      updatedAt: "2026-10-08T00:00:00Z",
      current: false,
    },
    {
      id: "other",
      browser: "Edge",
      os: "Windows",
      device: "desktop",
      createdAt: "2026-10-01T00:00:00Z",
      updatedAt: "2026-10-07T00:00:00Z",
      current: false,
    },
  ],
};
const meta = {
  title: "Settings/Screens",
  decorators: [
    (Story) => (
      <Frame>
        <Story />
      </Frame>
    ),
  ],
  parameters: {
    nextjs: { appDirectory: true, navigation: { pathname: "/settings" } },
  },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const Profile: Story = {
  render: () => (
    <>
      <SettingsTabLinks pathname="/settings" />
      <Suspense>
        <ProfileSettings data={profile} />
      </Suspense>
    </>
  ),
};
export const Account: Story = {
  render: () => (
    <>
      <SettingsTabLinks pathname="/settings/account" />
      <AccountSettings data={account} />
    </>
  ),
};
export const SocialOnly: Story = {
  render: () => (
    <>
      <SettingsTabLinks pathname="/settings/account" />
      <AccountSettings data={{ ...account, providers: ["google", "github"] }} />
    </>
  ),
};
export const Preferences: Story = {
  render: () => (
    <>
      <SettingsTabLinks pathname="/settings/preferences" />
      <PreferenceSettings
        data={{
          chatToasts: true,
          tabBadge: true,
          reminderMinutes: [30, 10, 5, 0],
          defaultBranchId: "first",
          branches: [
            { id: "first", name: "강남점" },
            { id: "second", name: "성수점" },
          ],
        }}
      />
    </>
  ),
};
export const Loading: Story = {
  render: () => (
    <>
      <SettingsTabLinks pathname="/settings" />
      <SettingsSkeleton tab="profile" />
    </>
  ),
};
export const Mobile: Story = {
  render: () => (
    <div className="mx-auto w-[340px] max-w-full space-y-5">
      <SettingsTabLinks pathname="/settings" />
      <ProfileSettings data={profile} />
    </div>
  ),
};
