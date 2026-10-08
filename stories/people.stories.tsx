import { useState, type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FriendsScreen } from "@/features/people/components/friends-screen";
import { PeopleShell } from "@/features/people/components/people-shell";
import { PersonProfileContent } from "@/features/people/components/person-card";
import type { FriendActions } from "@/features/people/components/friend-controls";
import type {
  FriendsTab,
  FriendsView,
  PersonProfile,
} from "@/features/people/types";

const person: PersonProfile = {
  userId: "00000000-0000-4000-8000-000000000002",
  name: "이서연",
  username: "seoyeon.lee",
  isMe: false,
  relation: "friend",
  sharedSpaces: [
    { id: "00000000-0000-4000-8000-000000000011", name: "디자인 팀" },
  ],
  directRoomId: "00000000-0000-4000-8000-000000000022",
  canDirectMessage: true,
};
const data: FriendsView = {
  messageRequestCount: 0,
  settings: {
    username: "haeun.kim",
    usernameChangedAt: null,
    nextChangeAt: null,
    now: "2026-10-08T03:00:00Z",
    suggestion: null,
  },
  receivedCount: 2,
  rows: [
    {
      userId: person.userId,
      name: person.name,
      username: person.username,
      sharedTeamNames: ["디자인 팀"],
      directRoomId: person.directRoomId,
    },
  ],
};
const actions: FriendActions = {
  send: async () => ({ ok: true, data: { relation: "outgoing" } }),
  respond: async () => ({ ok: true, data: undefined }),
  cancel: async () => ({ ok: true, data: undefined }),
  remove: async () => ({ ok: true, data: undefined }),
  openDirect: async () => ({
    ok: true,
    data: { roomId: person.directRoomId! },
  }),
};
function StoryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => {
    const result = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    result.setQueryData(["people", person.userId], person);
    return result;
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
function FriendsExample({
  tab = "all",
  empty = false,
  onboarding = false,
}: {
  tab?: FriendsTab;
  empty?: boolean;
  onboarding?: boolean;
}) {
  return (
    <StoryProvider>
      <PeopleShell title="친구">
        <FriendsScreen
          data={{
            ...data,
            rows: empty ? [] : data.rows,
            settings: onboarding
              ? { ...data.settings, username: null, suggestion: "haeun2" }
              : data.settings,
          }}
          tab={tab}
          actions={actions}
          search={async () => [
            { ...data.rows[0]!, relation: "friend", canDirectMessage: true },
          ]}
          saveUsername={async (input) => ({
            ok: true,
            data: { username: (input as { username: string }).username },
          })}
        />
      </PeopleShell>
    </StoryProvider>
  );
}
function ProfileExample({ variant }: { variant: "me" | "friend" | "unknown" }) {
  return (
    <StoryProvider>
      <div className="mx-auto mt-8 w-80 rounded-xl border bg-popover p-5 shadow-pop">
        <PersonProfileContent
          person={{
            ...person,
            isMe: variant === "me",
            relation:
              variant === "me"
                ? null
                : variant === "friend"
                  ? "friend"
                  : "none",
            canDirectMessage: variant === "friend",
            sharedSpaces: variant === "unknown" ? [] : person.sharedSpaces,
          }}
          actions={actions}
        />
      </div>
    </StoryProvider>
  );
}
const meta = {
  title: "People/Friends and profile",
  parameters: { layout: "fullscreen", nextjs: { appDirectory: true } },
  render: () => <FriendsExample />,
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const AllFriends: Story = {};
export const ReceivedRequests: Story = {
  render: () => <FriendsExample tab="received" />,
};
export const SentRequests: Story = {
  render: () => <FriendsExample tab="sent" />,
};
export const Empty: Story = { render: () => <FriendsExample empty /> };
export const UsernameOnboarding: Story = {
  render: () => <FriendsExample onboarding />,
};
export const MyProfile: Story = {
  render: () => <ProfileExample variant="me" />,
};
export const FriendProfile: Story = {
  render: () => <ProfileExample variant="friend" />,
};
export const UnknownProfile: Story = {
  render: () => <ProfileExample variant="unknown" />,
};
