import { Activity, Suspense, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UsernameForm } from "@/features/people/components/username-form";
import { FriendsScreen } from "@/features/people/components/friends-screen";
import { SettingsScreen } from "@/features/people/components/settings-screen";
import {
  PeopleShell,
  PeopleSkeleton,
} from "@/features/people/components/people-shell";
import { searchPeople } from "@/features/people/components/people-search";
import { ApiError } from "@/lib/http/errors";
import {
  MessagePersonButton,
  type FriendActions,
} from "@/features/people/components/friend-controls";
import { friendsTab } from "@/features/people/schema";
import type {
  FriendRow,
  FriendsView,
  PersonSearchResult,
  UsernameSettings,
} from "@/features/people/types";
import type { ActionResult } from "@/lib/actions/result";

const mocks = vi.hoisted(() => ({
  router: { push: vi.fn(), refresh: vi.fn() },
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("sonner", () => ({
  toast: { success: mocks.success, error: mocks.error },
}));
vi.mock("@/features/people/actions", () => ({
  setUsername: vi.fn(),
  sendFriendRequest: vi.fn(),
  respondFriendRequest: vi.fn(),
  cancelFriendRequest: vi.fn(),
  removeFriend: vi.fn(),
}));
vi.mock("@/features/chat/actions", () => ({ openDirectMessage: vi.fn() }));

const settings: UsernameSettings = {
  username: "haeun.kim",
  usernameChangedAt: null,
  nextChangeAt: null,
  now: "2030-01-01T00:00:00Z",
  suggestion: null,
};
const firstSettings: UsernameSettings = {
  ...settings,
  username: null,
  suggestion: "haeun2",
};
const person: FriendRow = {
  userId: "10000000-0000-4000-8000-000000000002",
  name: "이서연",
  avatar: { color: "blue" as const, photoUrl: null },
  username: "seoyeon.lee",
  sharedTeamNames: ["디자인 팀"],
  directRoomId: null,
};
const data: FriendsView = {
  settings,
  receivedCount: 2,
  messageRequestCount: 0,
  rows: [person],
};
const actions: FriendActions = {
  send: vi.fn(async () => ({
    ok: true as const,
    data: { relation: "outgoing" as const },
  })),
  respond: vi.fn(async () => ({ ok: true as const, data: undefined })),
  cancel: vi.fn(async () => ({ ok: true as const, data: undefined })),
  remove: vi.fn(async () => ({ ok: true as const, data: undefined })),
  openDirect: vi.fn(async () => ({
    ok: true as const,
    data: { roomId: "dm-room" },
  })),
};
function setup(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const rendered = render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
  return { ...rendered, client, user: userEvent.setup() };
}
beforeEach(() => {
  vi.clearAllMocks();
});

describe("username form and settings", () => {
  it("offers the suggestion, normalizes a submitted name and removes the onboarding card after save", async () => {
    const save = vi.fn(async () => ({
      ok: true as const,
      data: { username: "haeun.kim" },
    }));
    const { user } = setup(
      <FriendsScreen
        data={{ ...data, settings: firstSettings }}
        tab="all"
        actions={actions}
        saveUsername={save}
      />,
    );
    expect(screen.getByLabelText("사용자 이름")).toHaveValue("haeun2");
    expect(
      screen.getByText("이메일 앞부분으로 제안했어요. 바꿔도 돼요"),
    ).toBeVisible();
    await user.clear(screen.getByLabelText("사용자 이름"));
    await user.type(screen.getByLabelText("사용자 이름"), " @HAEUN.KIM ");
    await user.click(screen.getByRole("button", { name: "저장" }));
    expect(save).toHaveBeenCalledExactlyOnceWith({ username: "haeun.kim" });
    expect(
      screen.queryByRole("region", { name: "사용자 이름 정하기" }),
    ).not.toBeInTheDocument();
    expect(mocks.router.refresh).toHaveBeenCalledOnce();
  });
  it("validates before calling the server and connects the error to the input", async () => {
    const save = vi.fn();
    const { user } = setup(
      <UsernameForm settings={firstSettings} action={save} />,
    );
    const input = screen.getByLabelText("사용자 이름");
    await user.clear(input);
    await user.type(input, "한글");
    await user.click(screen.getByRole("button", { name: "저장" }));
    expect(save).not.toHaveBeenCalled();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(
      expect.stringContaining("영문 소문자"),
    );
  });
  it.each([
    [{ ok: false, code: "USERNAME_TAKEN" }, "이미 쓰고 있는 이름이에요"],
    [
      { ok: false, code: "LIMIT_EXCEEDED", message: "username_cooldown" },
      "아직 바꿀 수 없어요",
    ],
    [
      { ok: false, code: "INVALID_INPUT" },
      "영문 소문자, 숫자, `.`, `_`로 3–20자",
    ],
  ] as const)("shows safe username error %#", async (result, text) => {
    const { user } = setup(
      <UsernameForm settings={settings} action={async () => result} />,
    );
    await user.click(screen.getByRole("button", { name: "저장" }));
    expect(screen.getByRole("alert")).toHaveTextContent(text);
  });
  it("blocks duplicate saves while pending and retains input after a thrown private error", async () => {
    const pending = Promise.withResolvers<ActionResult<{ username: string }>>();
    const save = vi.fn(() => pending.promise);
    const { user } = setup(<UsernameForm settings={settings} action={save} />);
    const submit = screen.getByRole("button", { name: "저장" });
    await user.click(submit);
    fireEvent.click(submit);
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () =>
      pending.reject(new Error("secret-email@example.test")),
    );
    expect(screen.getByLabelText("사용자 이름")).toHaveValue("haeun.kim");
    expect(screen.getByRole("alert")).not.toHaveTextContent("secret-email");
  });
  it("uses the server-provided Seoul cooldown date and exposes no editable real name", () => {
    setup(
      <SettingsScreen
        name="김하은"
        settings={{ ...settings, nextChangeAt: "2030-01-30T16:00:00Z" }}
      />,
    );
    expect(screen.getByText("김하은")).toBeVisible();
    expect(screen.getByLabelText("사용자 이름")).toBeDisabled();
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
    expect(screen.getByText("1월 31일부터 다시 바꿀 수 있어요")).toBeVisible();
    expect(
      screen.queryByRole("textbox", { name: "이름" }),
    ).not.toBeInTheDocument();
  });
});

describe("friends search, tabs and actions", () => {
  it("searches only on submit and displays safe result identity without a profile trigger", async () => {
    const search = vi.fn(async () => [
      { ...person, relation: "none" as const, canDirectMessage: false },
    ]);
    const { user } = setup(
      <FriendsScreen
        data={{ ...data, rows: [] }}
        tab="all"
        actions={actions}
        search={search}
      />,
    );
    await user.type(
      screen.getByLabelText("사용자 이름이나 이메일"),
      "seoyeon.lee",
    );
    expect(search).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");
    expect(search).toHaveBeenCalledExactlyOnceWith(
      "seoyeon.lee",
      expect.any(AbortSignal),
    );
    const result = within(screen.getByRole("list", { name: "찾은 사람" }));
    expect(result.getByText("@seoyeon.lee")).toBeVisible();
    expect(result.getByText("디자인 팀")).toBeVisible();
    expect(
      result.queryByRole("button", { name: /이서연/ }),
    ).not.toBeInTheDocument();
    await user.click(result.getByRole("button", { name: "친구 요청" }));
    expect(actions.send).toHaveBeenCalledWith({ userId: person.userId });
    expect(result.getByRole("button", { name: "요청 보냄" })).toBeDisabled();
    expect(mocks.success).toHaveBeenCalledWith("친구 요청을 보냈어요");
  });
  it.each([
    ["outgoing", "요청 보냄"],
    ["incoming", "수락"],
    ["friend", "메시지"],
  ] as const)(
    "renders the %s search relationship",
    async (relation, button) => {
      const { user } = setup(
        <FriendsScreen
          data={{ ...data, rows: [] }}
          tab="all"
          actions={actions}
          search={async () => [
            { ...person, relation, canDirectMessage: relation === "friend" },
          ]}
        />,
      );
      await user.type(
        screen.getByLabelText("사용자 이름이나 이메일"),
        "person",
      );
      await user.click(screen.getByRole("button", { name: "찾기" }));
      expect(
        within(screen.getByRole("list", { name: "찾은 사람" })).getByRole(
          "button",
          { name: button },
        ),
      ).toBeVisible();
    },
  );
  it("shows distinct empty search and rate-limit messages without a false empty state while pending", async () => {
    const pending = Promise.withResolvers<PersonSearchResult[]>();
    const search = vi
      .fn()
      .mockReturnValueOnce(pending.promise)
      .mockRejectedValueOnce(new ApiError("http", { status: 429 }));
    const { user } = setup(
      <FriendsScreen
        data={{ ...data, rows: [] }}
        tab="all"
        actions={actions}
        search={search}
      />,
    );
    await user.type(screen.getByLabelText("사용자 이름이나 이메일"), "person");
    await user.click(screen.getByRole("button", { name: "찾기" }));
    expect(screen.queryByText(/찾는 사람이 없어요/)).not.toBeInTheDocument();
    expect(screen.getByText("사람을 찾고 있어요")).toBeVisible();
    await act(async () => pending.resolve([]));
    expect(screen.getByText(/찾는 사람이 없어요/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "찾기" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "찾기를 너무 많이 했어요. 잠시 뒤에 다시 해 주세요",
    );
  });
  it.each([
    ["all", "아직 친구가 없어요. 위에서 사용자 이름이나 이메일로 찾아 보세요"],
    ["received", "받은 요청이 없어요"],
    ["sent", "보낸 요청이 없어요"],
  ] as const)("renders the %s tab and its own empty state", (tab, empty) => {
    setup(
      <FriendsScreen
        data={{ ...data, rows: [] }}
        tab={tab}
        actions={actions}
      />,
    );
    expect(screen.getByText(empty)).toBeVisible();
    expect(screen.getByRole("link", { name: "받은 요청 2" })).toHaveAttribute(
      "href",
      "/friends?tab=received",
    );
    expect(
      screen
        .getByRole("navigation", { name: "친구 목록" })
        .querySelector('[aria-current="page"]'),
    ).toHaveAttribute(
      "href",
      tab === "all" ? "/friends" : `/friends?tab=${tab}`,
    );
  });
  it("normalizes unsupported and repeated tab values to all", () => {
    expect(friendsTab("blocked")).toBe("blocked");
    expect(friendsTab("requests")).toBe("requests");
    expect(friendsTab("unknown")).toBe("all");
    expect(friendsTab(["sent"])).toBe("all");
    expect(friendsTab(undefined)).toBe("all");
  });
  it.each([
    [true, "수락", "이제 친구예요"],
    [false, "거절", "요청을 거절했어요"],
  ] as const)("responds with accept=%s", async (accept, label, toast) => {
    const { user } = setup(
      <FriendsScreen data={data} tab="received" actions={actions} />,
    );
    await user.click(screen.getByRole("button", { name: label }));
    expect(actions.respond).toHaveBeenCalledWith({
      userId: person.userId,
      accept,
    });
    expect(mocks.success).toHaveBeenCalledWith(toast);
  });
  it("cancels an outgoing request without exposing its hidden server status", async () => {
    const { user } = setup(
      <FriendsScreen data={data} tab="sent" actions={actions} />,
    );
    expect(screen.queryByText(/거절/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "취소" }));
    expect(actions.cancel).toHaveBeenCalledWith({ userId: person.userId });
    expect(mocks.success).toHaveBeenCalledWith("요청을 취소했어요");
  });
  it("opens a DM only once, or retains the existing link", async () => {
    const pending = Promise.withResolvers<ActionResult<{ roomId: string }>>();
    const openDirect = vi.fn(() => pending.promise);
    const { user } = setup(
      <MessagePersonButton person={person} action={openDirect} />,
    );
    const button = screen.getByRole("button", { name: "메시지" });
    await user.click(button);
    fireEvent.click(button);
    expect(openDirect).toHaveBeenCalledTimes(1);
    await act(async () =>
      pending.resolve({ ok: true, data: { roomId: "new-dm" } }),
    );
    expect(mocks.router.push).toHaveBeenCalledExactlyOnceWith("/dm/new-dm");
  });
  it("confirms removing a friend, retains the message and restores menu trigger focus", async () => {
    const { user } = setup(
      <FriendsScreen data={data} tab="all" actions={actions} />,
    );
    const trigger = screen.getByRole("button", { name: "이서연 더보기" });
    await user.click(trigger);
    await user.click(screen.getByRole("menuitem", { name: "친구 끊기" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAccessibleName("이서연 님과 친구를 끊을까요?");
    expect(dialog).toHaveTextContent("지금까지의 대화는 남아요");
    expect(actions.remove).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "친구 끊기" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(actions.remove).toHaveBeenCalledWith({ userId: person.userId });
    expect(mocks.success).toHaveBeenCalledWith("친구를 끊었어요");
    expect(trigger).toHaveFocus();
  });
  it.each([
    ["friend_daily", "오늘은 친구 요청을 더 보낼 수 없어요"],
    ["friend_cooldown", "취소한 요청은 하루 뒤에 다시 보낼 수 있어요"],
  ])("shows the safe %s failure", async (message, expected) => {
    const { user } = setup(
      <FriendsScreen
        data={{ ...data, rows: [] }}
        tab="all"
        actions={{
          ...actions,
          send: async () => ({ ok: false, code: "LIMIT_EXCEEDED", message }),
        }}
        search={async () => [
          { ...person, relation: "none", canDirectMessage: false },
        ]}
      />,
    );
    await user.type(screen.getByLabelText("사용자 이름이나 이메일"), "person");
    await user.click(screen.getByRole("button", { name: "찾기" }));
    await user.click(screen.getByRole("button", { name: "친구 요청" }));
    expect(mocks.error).toHaveBeenCalledWith(expected);
  });
  it("does not navigate from a late DM response after the preserved view is hidden", async () => {
    const pending = Promise.withResolvers<ActionResult<{ roomId: string }>>();
    const client = new QueryClient();
    const open = () => pending.promise;
    const ui = (mode: "visible" | "hidden") => (
      <QueryClientProvider client={client}>
        <Activity mode={mode}>
          <MessagePersonButton person={person} action={open} />
        </Activity>
      </QueryClientProvider>
    );
    const { rerender } = render(ui("visible"));
    await userEvent.click(screen.getByRole("button", { name: "메시지" }));
    rerender(ui("hidden"));
    await act(async () =>
      pending.resolve({ ok: true, data: { roomId: "late" } }),
    );
    expect(mocks.router.push).not.toHaveBeenCalled();
  });
});

describe("fixed shell and safe search client", () => {
  it("exposes the static heading before settings and personal data resolve", () => {
    const never = new Promise(() => {});
    function Waiting(): ReactNode {
      throw never;
    }
    render(
      <PeopleShell title="친구">
        <Suspense fallback={<PeopleSkeleton />}>
          <Waiting />
        </Suspense>
      </PeopleShell>,
    );
    expect(
      screen.getByRole("heading", { name: "친구", level: 1 }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "친구 추가", level: 2 }),
    ).toBeVisible();
    expect(screen.queryByText(/아직 친구가 없어요/)).not.toBeInTheDocument();
  });
  it("encodes exact search values, disables cache and rejects unknown response fields", async () => {
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [
              {
                userId: person.userId,
                name: person.name,
                avatar: { color: "blue" as const, photoUrl: null },
                username: person.username,
                sharedTeamNames: [],
                relation: "none",
                directRoomId: null,
                canDirectMessage: false,
              },
            ],
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [
              {
                ...person,
                relation: "none",
                canDirectMessage: false,
                email: "private@example.test",
              },
            ],
          }),
        ),
      );
    const controller = new AbortController();
    await expect(
      searchPeople("name+tag@example.test", controller.signal),
    ).resolves.toHaveLength(1);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/people/search?q=name%2Btag%40example.test",
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        cache: "no-store",
        credentials: "same-origin",
        method: "GET",
      }),
    );
    await expect(searchPeople("name", controller.signal)).rejects.toThrow();
    fetcher.mockRestore();
  });
});
