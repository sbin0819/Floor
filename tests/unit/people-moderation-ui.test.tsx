import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { FriendsScreen } from "@/features/people/components/friends-screen";
import {
  ProfilePersonActions,
  SearchPersonActions,
} from "@/features/people/components/person-actions";
import { PersonProfileContent } from "@/features/people/components/person-card";
import { ChannelMembers } from "@/features/chat/components/channel-members";
import { MessageRequestsList } from "@/features/people/components/message-requests-list";
import type { FriendActions } from "@/features/people/components/friend-controls";
import type { ModerationActions } from "@/features/people/components/moderation-dialogs";
import type {
  FriendsView,
  PersonProfile,
  MessageRequestRow,
} from "@/features/people/types";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  push: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  unblock: vi.fn(async () => ({ ok: true as const, data: {} })),
}));
vi.mock("next/navigation", () => ({ useRouter: () => mocks }));
vi.mock("sonner", () => ({
  toast: { success: mocks.success, error: mocks.error },
}));
vi.mock("@/features/people/actions", () => ({ unblockUser: mocks.unblock }));
vi.mock("@/components/realtime-provider", () => ({
  usePresenceStatus: (_id: string, shared: boolean) =>
    shared ? "dnd" : "unknown",
  usePresenceStatuses: () => ({
    a: "unknown",
    b: "offline",
    c: "online",
    d: "dnd",
  }),
}));
const person: PersonProfile = {
  userId: "other",
  name: "박지훈",
  username: "jihoon",
  isMe: false,
  relation: "none",
  sharedSpaces: [],
  canDirectMessage: false,
  directRoomId: null,
};
const friendActions = (): FriendActions => ({
  send: vi.fn(async () => ({
    ok: true as const,
    data: { relation: "outgoing" as const },
  })),
  respond: vi.fn(async () => ({ ok: true as const, data: {} })),
  cancel: vi.fn(async () => ({ ok: true as const, data: {} })),
  remove: vi.fn(async () => ({ ok: true as const, data: {} })),
  openDirect: vi.fn(async () => ({
    ok: true as const,
    data: { roomId: "direct" },
  })),
});
const moderation = (): ModerationActions => ({
  block: vi.fn(async () => ({ ok: true as const, data: {} })),
  unblock: mocks.unblock,
  reportUser: vi.fn(async () => ({ ok: true as const, data: {} })),
  reportMessage: vi.fn(async () => ({ ok: true as const, data: {} })),
});
const data: FriendsView = {
  settings: {
    username: "me",
    usernameChangedAt: null,
    nextChangeAt: null,
    now: "2030-01-01T03:00:00Z",
    suggestion: null,
  },
  rows: [],
  receivedCount: 0,
  messageRequestCount: 1,
};
async function setup(ui: ReactNode) {
  const client = new QueryClient();
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
    );
  });
  return { ...result, client, user: userEvent.setup() };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("request and block tabs", () => {
  it("shows the request count and fixed tabs before the request list, never a false empty state", async () => {
    const pending = Promise.withResolvers<MessageRequestRow[]>();
    await setup(
      <FriendsScreen data={data} tab="requests" requests={pending.promise} />,
    );
    expect(screen.getByRole("link", { name: "메시지 요청 1" })).toHaveAttribute(
      "href",
      "/friends?tab=requests",
    );
    expect(screen.getByRole("link", { name: "차단" })).toHaveAttribute(
      "href",
      "/friends?tab=blocked",
    );
    expect(
      screen.queryByText("받은 메시지 요청이 없어요"),
    ).not.toBeInTheDocument();
    await act(async () => pending.resolve([]));
    expect(screen.getByText("받은 메시지 요청이 없어요")).toBeVisible();
  });
  it("links request rows to their DM and formats age in Seoul without leaking email", async () => {
    await setup(
      <MessageRequestsList
        now={data.settings.now}
        rows={[
          {
            roomId: "room",
            other: { userId: "other", name: "박지훈", username: "jihoon" },
            excerpt: "안녕하세요",
            lastMessageAt: "2030-01-01T02:50:00Z",
          },
        ]}
      />,
    );
    expect(screen.getByRole("link", { name: /박지훈/ })).toHaveAttribute(
      "href",
      "/dm/room",
    );
    expect(screen.getByText("10분 전")).toBeVisible();
    expect(screen.getByText("@jihoon")).toBeVisible();
  });
  it("unblocks from a blocked row without another confirmation and has a distinct empty state", async () => {
    const { user } = await setup(
      <FriendsScreen
        data={{
          ...data,
          rows: [
            {
              userId: "other",
              name: "박지훈",
              username: "jihoon",
              directRoomId: "room",
              sharedTeamNames: [],
            },
          ],
        }}
        tab="blocked"
      />,
    );
    await user.click(screen.getByRole("button", { name: "차단 풀기" }));
    expect(mocks.unblock).toHaveBeenCalledExactlyOnceWith({ userId: "other" });
    expect(mocks.success).toHaveBeenCalledWith("차단을 풀었어요");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("labels the empty blocked tab without implying any one user's blocking choice", async () => {
    await setup(<FriendsScreen data={data} tab="blocked" />);
    expect(screen.getByText("차단한 사람이 없어요")).toBeVisible();
  });
});

describe("profile and search moderation", () => {
  it.each([true, false])(
    "chooses a direct room or request dialog from canDirectMessage=%s",
    async (canDirectMessage) => {
      const actions = friendActions();
      const { user } = await setup(
        <SearchPersonActions
          person={{
            ...person,
            relation: "none",
            sharedTeamNames: [],
            canDirectMessage,
          }}
          actions={actions}
        />,
      );
      await user.click(screen.getByRole("button", { name: "메시지" }));
      if (canDirectMessage) {
        expect(actions.openDirect).toHaveBeenCalledExactlyOnceWith({
          userId: "other",
        });
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      } else {
        expect(
          screen.getByRole("dialog", { name: "박지훈 님에게 메시지 보내기" }),
        ).toBeVisible();
        expect(actions.openDirect).not.toHaveBeenCalled();
      }
    },
  );
  it("uses only unblock for my blocked exact search result", async () => {
    await setup(
      <SearchPersonActions
        person={{ ...person, relation: "blocked", sharedTeamNames: [] }}
      />,
    );
    expect(screen.getByRole("button", { name: "차단 풀기" })).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "메시지" }),
    ).not.toBeInTheDocument();
  });
  it("asks before blocking from the profile's one menu and restores keyboard focus", async () => {
    const actions = moderation();
    const { user } = await setup(
      <ProfilePersonActions
        person={person}
        actions={friendActions()}
        moderation={actions}
      />,
    );
    const menu = screen.getByRole("button", { name: "박지훈 더보기" });
    await user.click(menu);
    await user.click(screen.getByRole("menuitem", { name: "차단" }));
    expect(
      screen.getByRole("dialog", { name: "박지훈 님을 차단할까요?" }),
    ).toBeVisible();
    expect(actions.block).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(menu).toHaveFocus());
  });
  it("maps a forbidden friend request to the generic sentence", async () => {
    const actions = {
      ...friendActions(),
      send: vi.fn(async () => ({
        ok: false as const,
        code: "FORBIDDEN" as const,
      })),
    };
    const { user } = await setup(
      <SearchPersonActions
        person={{ ...person, relation: "none", sharedTeamNames: [] }}
        actions={actions}
      />,
    );
    await user.click(screen.getByRole("button", { name: "친구 요청" }));
    expect(mocks.error).toHaveBeenCalledWith("친구 요청을 보낼 수 없어요");
  });
  it("shows profile status only for shared-space knowledge and orders known online members first", async () => {
    const { unmount } = await setup(
      <PersonProfileContent
        person={{ ...person, sharedSpaces: [{ id: "space", name: "공유 팀" }] }}
        actions={friendActions()}
      />,
    );
    expect(screen.getByRole("img", { name: "방해 금지" })).toBeVisible();
    unmount();
    await setup(
      <ChannelMembers
        members={[
          { id: "a", name: "가영", admin: false, sharesSpace: false },
          { id: "b", name: "나영", admin: false, sharesSpace: true },
          { id: "c", name: "다영", admin: false, sharesSpace: true },
          { id: "d", name: "라영", admin: false, sharesSpace: true },
        ]}
      />,
    );
    expect(
      screen
        .getAllByRole("listitem")
        .map((row) =>
          within(row).getByRole("button").getAttribute("aria-label"),
        ),
    ).toEqual(["다영 프로필", "라영 프로필", "나영 프로필", "가영 프로필"]);
    expect(
      within(screen.getAllByRole("listitem")[3]!).queryByRole("img"),
    ).not.toBeInTheDocument();
  });
});
