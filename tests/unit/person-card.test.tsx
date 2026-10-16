import { Activity, type ReactNode } from "react";
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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PersonCard,
  PersonProfileContent,
  readPersonProfile,
} from "@/features/people/components/person-card";
import { ChannelMembers } from "@/features/chat/components/channel-members";
import { MessageList } from "@/features/chat/components/message-list";
import { emptyMessageDetails } from "@/features/chat/types";
import type { PersonProfile } from "@/features/people/types";
import type { FriendActions } from "@/features/people/components/friend-controls";
import { ApiError } from "@/lib/http/errors";
import { installChatViewport } from "../helpers/chat-viewport";

const mocks = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => mocks }));
vi.mock("@/features/people/actions", () => ({
  sendFriendRequest: vi.fn(),
  respondFriendRequest: vi.fn(),
  cancelFriendRequest: vi.fn(),
  removeFriend: vi.fn(),
}));
vi.mock("@/features/chat/actions", () => ({ openDirectMessage: vi.fn() }));
const id = "10000000-0000-4000-8000-000000000002";
const room = "10000000-0000-4000-8000-000000000003";
const space = "10000000-0000-4000-8000-000000000004";
const person: PersonProfile = {
  userId: id,
  name: "이서연",
  avatar: { color: "blue", photoUrl: null },
  username: "seoyeon.lee",
  isMe: false,
  relation: "friend",
  sharedSpaces: [{ id: space, name: "디자인 팀" }],
  directRoomId: room,
  canDirectMessage: true,
};
const actions: FriendActions = {
  send: vi.fn<FriendActions["send"]>(async () => ({
    ok: true,
    data: { relation: "outgoing" },
  })),
  respond: vi.fn<FriendActions["respond"]>(async () => ({
    ok: true,
    data: undefined,
  })),
  cancel: vi.fn<FriendActions["cancel"]>(async () => ({
    ok: true,
    data: undefined,
  })),
  remove: vi.fn<FriendActions["remove"]>(async () => ({
    ok: true,
    data: undefined,
  })),
  openDirect: vi.fn<FriendActions["openDirect"]>(async () => ({
    ok: true,
    data: { roomId: room },
  })),
};
function setup(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const result = render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
  return { ...result, client, user: userEvent.setup() };
}
function card(profile: PersonProfile | null = person) {
  const read = vi.fn(async () => profile);
  return {
    read,
    element: (
      <PersonCard userId={id} name={person.name} read={read} actions={actions}>
        <button>프로필 열기</button>
      </PersonCard>
    ),
  };
}
beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PersonCard", () => {
  it.each([
    ["timeout", "응답이 늦어지고 있어요. 잠시 뒤 다시 시도해 주세요"],
    ["network", "연결을 확인한 뒤 다시 시도해 주세요"],
  ] as const)(
    "shows common %s guidance without exposing error details",
    async (kind, message) => {
      const error = new ApiError(kind);
      error.message = "private@example.com";
      const read = vi.fn().mockRejectedValue(error);
      const { user } = setup(
        <PersonCard userId={id} name={person.name} read={read}>
          <button>프로필 열기</button>
        </PersonCard>,
      );
      await user.click(screen.getByRole("button", { name: "프로필 열기" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(message);
      expect(screen.queryByText("private@example.com")).not.toBeInTheDocument();
      expect(
        screen.queryByText("이 사용자를 볼 수 없어요"),
      ).not.toBeInTheDocument();
    },
  );
  it("renders the profile preview with disabled actions and non-interactive shared spaces", async () => {
    const { user } = setup(
      <PersonProfileContent
        person={{ ...person, isMe: true }}
        actions={actions}
        preview
      />,
    );
    expect(screen.getByRole("button", { name: "설정" })).toBeDisabled();
    expect(screen.getByText("디자인 팀")).toBeVisible();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "설정" }));
    for (const action of Object.values(actions))
      expect(action).not.toHaveBeenCalled();
  });
  it("queries only when opened, shares the 30 second cache, and returns keyboard focus to the trigger", async () => {
    const { read, element } = card();
    const { user, client } = setup(element);
    expect(read).not.toHaveBeenCalled();
    await user.tab();
    await user.keyboard("{Enter}");
    const dialog = await screen.findByRole("dialog", { name: "이서연 프로필" });
    expect(
      await within(dialog).findByRole("heading", { name: "이서연" }),
    ).toBeVisible();
    expect(read).toHaveBeenCalledExactlyOnceWith(id, expect.any(AbortSignal));
    expect(
      client.getQueryCache().find({ queryKey: ["people", id] })?.options,
    ).toMatchObject({ staleTime: 30_000 });
    expect(
      within(dialog).getByRole("link", { name: "디자인 팀" }),
    ).toHaveAttribute("href", `/s/${space}`);
    expect(
      within(dialog).getByRole("link", { name: "메시지" }),
    ).toHaveAttribute("href", `/dm/${room}`);
    expect(within(dialog).queryByText(/email|@ai.com/)).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "프로필 열기" })).toHaveFocus(),
    );
    await user.keyboard("{Enter}");
    expect(read).toHaveBeenCalledTimes(1);
  });
  it("renders a data-only skeleton without pretending the relationship is empty", async () => {
    let resolve!: (value: PersonProfile) => void;
    const read = vi.fn(
      () =>
        new Promise<PersonProfile>((done) => {
          resolve = done;
        }),
    );
    const { user } = setup(
      <PersonCard userId={id} name={person.name} read={read}>
        <button>열기</button>
      </PersonCard>,
    );
    await user.click(screen.getByRole("button", { name: "열기" }));
    expect(
      screen.getByRole("status", { name: "프로필을 불러오고 있어요" }),
    ).toBeVisible();
    expect(
      screen.queryByText("친구가 되면 메시지를 보낼 수 있어요"),
    ).not.toBeInTheDocument();
    await act(async () => resolve(person));
    expect(
      await screen.findByRole("heading", { name: person.name }),
    ).toBeVisible();
  });
  it("shows only settings for myself and omits an absent username", async () => {
    const { element } = card({
      ...person,
      isMe: true,
      username: null,
      relation: null,
    });
    const { user } = setup(element);
    await user.click(screen.getByRole("button", { name: "프로필 열기" }));
    expect(await screen.findByRole("link", { name: "설정" })).toHaveAttribute(
      "href",
      "/settings",
    );
    expect(screen.queryByText("@seoyeon.lee")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "메시지" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /친구|더보기/ }),
    ).not.toBeInTheDocument();
  });
  it.each([
    ["none", "친구 추가"],
    ["outgoing", "요청 보냄"],
    ["incoming", "요청 수락"],
  ] as const)(
    "shows the %s relationship and opens a message request instead of a direct conversation",
    async (relation, label) => {
      const { element } = card({
        ...person,
        relation,
        canDirectMessage: false,
        directRoomId: null,
      });
      const { user } = setup(element);
      await user.click(screen.getByRole("button", { name: "프로필 열기" }));
      expect(await screen.findByRole("button", { name: label })).toBeVisible();
      if (relation === "outgoing")
        expect(screen.getByRole("button", { name: label })).toBeDisabled();
      await user.click(screen.getByRole("button", { name: "메시지" }));
      expect(
        screen.getByRole("dialog", { name: "이서연 님에게 메시지 보내기" }),
      ).toBeVisible();
      expect(
        screen.getByText(/친구가 아니어서 메시지 요청으로 가요/),
      ).toBeVisible();
      expect(actions.openDirect).not.toHaveBeenCalled();
    },
  );
  it("invalidates and rereads the person's card after a friend action", async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce({
        ...person,
        relation: "none",
        canDirectMessage: false,
      })
      .mockResolvedValue({
        ...person,
        relation: "outgoing",
        canDirectMessage: false,
      });
    const { user } = setup(
      <PersonCard userId={id} name={person.name} read={read} actions={actions}>
        <button>열기</button>
      </PersonCard>,
    );
    await user.click(screen.getByRole("button", { name: "열기" }));
    await user.click(await screen.findByRole("button", { name: "친구 추가" }));
    expect(actions.send).toHaveBeenCalledExactlyOnceWith({ userId: id });
    expect(
      await screen.findByRole("button", { name: "요청 보냄" }),
    ).toBeDisabled();
    expect(read).toHaveBeenCalledTimes(2);
  });
  it("does not disclose a profile for the uniform absent response", async () => {
    const { element } = card(null);
    const { user } = setup(element);
    await user.click(screen.getByRole("button", { name: "프로필 열기" }));
    expect(await screen.findByText("이 사용자를 볼 수 없어요")).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: person.name }),
    ).not.toBeInTheDocument();
  });
  it("uses a bottom Sheet below 768px with one dialog and returns focus after close", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    const { element } = card();
    const { user } = setup(element);
    await user.click(screen.getByRole("button", { name: "프로필 열기" }));
    const dialog = await screen.findByRole("dialog", { name: "이서연 프로필" });
    expect(dialog).toHaveAttribute("data-side", "bottom");
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "프로필 닫기" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "프로필 열기" })).toHaveFocus(),
    );
  });
  it("cancels its request when hidden and never renders another person's late profile", async () => {
    let signal!: AbortSignal;
    const read = vi.fn((_id: string, value: AbortSignal) => {
      signal = value;
      return new Promise<PersonProfile>(() => {});
    });
    const client = new QueryClient();
    const ui = (mode: "visible" | "hidden") => (
      <QueryClientProvider client={client}>
        <Activity mode={mode}>
          <PersonCard userId={id} name="이서연" read={read}>
            <button>열기</button>
          </PersonCard>
        </Activity>
      </QueryClientProvider>
    );
    const { rerender } = render(ui("visible"));
    fireEvent.click(screen.getByRole("button", { name: "열기" }));
    await waitFor(() => expect(read).toHaveBeenCalledOnce());
    rerender(ui("hidden"));
    expect(signal.aborted).toBe(true);
  });
  it("opens from the channel member row", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(person)),
    );
    const { user } = setup(
      <ChannelMembers
        members={[
          { id, name: person.name, avatar: person.avatar, admin: false },
        ]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "이서연 프로필" }));
    expect(
      await screen.findByRole("heading", { name: "이서연" }),
    ).toBeVisible();
  });
  it("keeps the author buttons reachable from the existing roving message focus", async () => {
    const restore = installChatViewport();
    try {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json(person)),
      );
      const { user } = setup(
        <MessageList
          channelName="일반"
          now="2030-01-01T00:00:00Z"
          userId="me"
          onRetry={vi.fn()}
          onRemove={vi.fn()}
          messages={[
            {
              ...emptyMessageDetails(),
              id: "message",
              seq: 1,
              authorId: id,
              authorName: person.name,
              authorAvatar: person.avatar,
              body: "안녕하세요",
              kind: "text",
              clientId: null,
              createdAt: "2030-01-01T00:00:00Z",
            },
          ]}
        />,
      );
      fireEvent.keyDown(screen.getByRole("region", { name: "일반 메시지" }), {
        key: "ArrowUp",
      });
      await waitFor(() => expect(screen.getByRole("article")).toHaveFocus());
      await user.tab();
      expect(
        screen.getByRole("button", { name: "이서연 아바타 프로필" }),
      ).toHaveFocus();
      await user.tab();
      expect(
        screen.getByRole("button", { name: "이서연 프로필" }),
      ).toHaveFocus();
      await user.keyboard("{Enter}");
      expect(
        await screen.findByRole("heading", { name: "이서연" }),
      ).toBeVisible();
      await user.keyboard("{Escape}");
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "이서연 프로필" }),
        ).toHaveFocus(),
      );
    } finally {
      restore();
    }
  });
});

describe("profile response boundary", () => {
  it("uses a private uncached cancellable GET and returns null only for 404", async () => {
    const fetcher = vi.fn(async () => Response.json(person));
    vi.stubGlobal("fetch", fetcher);
    const signal = new AbortController().signal;
    await expect(readPersonProfile(id, signal)).resolves.toEqual(person);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      `/api/people/${id}`,
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        cache: "no-store",
        credentials: "same-origin",
        method: "GET",
      }),
    );
    fetcher.mockResolvedValueOnce(new Response(null, { status: 404 }));
    await expect(readPersonProfile(id, signal)).resolves.toBeNull();
    fetcher.mockResolvedValueOnce(new Response(null, { status: 403 }));
    await expect(readPersonProfile(id, signal)).rejects.toMatchObject({
      kind: "http",
      status: 403,
    });
  });
  it("rejects a response carrying any extra private data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ ...person, email: "private@example.test" }),
      ),
    );
    await expect(
      readPersonProfile(id, new AbortController().signal),
    ).rejects.toThrow();
  });
});
