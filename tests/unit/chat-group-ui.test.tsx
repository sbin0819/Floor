import { Activity, useState, type ReactNode } from "react";
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
import { MessageContacts } from "@/features/chat/components/message-contacts";
import {
  GroupDialogs,
  type GroupActions,
  type GroupDialog,
} from "@/features/chat/components/group-dialogs";
import { DirectMessageScreen } from "@/features/chat/components/channel-screen";
import { DirectMessageList } from "@/features/chat/components/direct-message-list";
import type { MessageContact } from "@/features/people/types";
import {
  emptyMessageDetails,
  type DirectMessageView,
} from "@/features/chat/types";
import type { ActionResult } from "@/lib/actions/result";
import { installChatViewport } from "../helpers/chat-viewport";

const router = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  success: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/dm/group",
}));
vi.mock("sonner", () => ({
  toast: { success: router.success, error: vi.fn() },
}));
vi.mock("@/features/chat/actions", () => ({
  sendMessage: vi.fn(),
  setReaction: vi.fn(),
  editMessage: vi.fn(),
  deleteMessage: vi.fn(),
  setRoomMuted: vi.fn(),
  markRoomRead: vi.fn(async () => ({ ok: true, data: { lastReadSeq: 1 } })),
}));
const contacts: MessageContact[] = Array.from({ length: 11 }, (_, index) => ({
  userId: `p${index}`,
  name: `사람${index}`,
  username: `person${index}`,
  directRoomId: null,
  isFriend: true,
  sharedTeamNames: [],
}));
const actions = (): GroupActions => ({
  add: vi.fn(async () => ({ ok: true as const, data: {} })),
  leave: vi.fn(async () => ({ ok: true as const, data: {} })),
  rename: vi.fn(async () => ({ ok: true as const, data: {} })),
});
async function setup(ui: ReactNode) {
  const client = new QueryClient();
  client.setQueryData(["chat", "nav"], {
    spaces: [],
    directMessages: [],
    myStatus: "online",
    blockedUserIds: [],
    meetings: [],
    now: "2026-10-08T03:00:00.000Z",
  });
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
    );
  });
  return { ...result, client, user: userEvent.setup() };
}
let restore: () => void;
beforeEach(() => {
  vi.clearAllMocks();
  restore = installChatViewport();
});
afterEach(() => restore());

describe("new group selection", () => {
  it("renders a group inbox row with peer initials, member count and unread styling but no status", async () => {
    await setup(
      <DirectMessageList
        rows={[
          {
            kind: "group_dm",
            roomId: "group",
            name: null,
            memberCount: 5,
            members: [
              { userId: "a", name: "김하은" },
              { userId: "b", name: "박지훈" },
              { userId: "c", name: "이서연" },
            ],
            lastSeq: 4,
            lastMessageAt: "2030-01-01T00:00:00Z",
            unread: true,
            unreadCount: 3,
            unreadMentions: 0,
            muted: false,
          },
        ]}
      />,
    );
    const link = screen.getByRole("link", {
      name: "김하은, 박지훈, 이서연 외 1명, 5명, 읽지 않은 메시지 3개",
    });
    expect(link).toHaveAttribute("href", "/dm/group");
    expect(link).toHaveAttribute("aria-current", "page");
    expect(link).toHaveClass("font-bold");
    expect(within(link).getByText("김")).toBeVisible();
    expect(within(link).getByText("박")).toBeVisible();
    expect(within(link).queryByText("이")).not.toBeInTheDocument();
    expect(within(link).getByText("5명")).toBeVisible();
    expect(within(link).queryByRole("img")).not.toBeInTheDocument();
  });
  it("selects one person without a request, then starts their DM on submit", async () => {
    const open = vi.fn(async () => ({
      ok: true as const,
      data: { roomId: "direct" },
    }));
    const create = vi.fn();
    const { user } = await setup(
      <MessageContacts people={contacts} open={open} create={create} />,
    );
    await user.click(screen.getByRole("checkbox", { name: "사람0 선택" }));
    expect(open).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("그룹 이름 (선택)")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "메시지" }));
    expect(open).toHaveBeenCalledExactlyOnceWith({ userId: "p0" });
    expect(create).not.toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledWith("/dm/direct");
  });
  it("creates a named group with two people and does not double-submit", async () => {
    const create = vi.fn(async () => ({
      ok: true as const,
      data: { roomId: "group" },
    }));
    const { user } = await setup(
      <MessageContacts people={contacts} create={create} />,
    );
    for (const index of [0, 1])
      await user.click(
        screen.getByRole("checkbox", { name: `사람${index} 선택` }),
      );
    await user.type(screen.getByLabelText("그룹 이름 (선택)"), "  점심 모임  ");
    fireEvent.click(screen.getByRole("button", { name: "그룹 만들기 (3명)" }));
    fireEvent.click(screen.getByRole("button", { name: "그룹 만들기 (3명)" }));
    await waitFor(() =>
      expect(create).toHaveBeenCalledExactlyOnceWith({
        userIds: ["p0", "p1"],
        name: "점심 모임",
      }),
    );
    expect(router.push).toHaveBeenCalledWith("/dm/group");
  });
  it("allows nine other people, rejects a tenth, and counts Unicode group names", async () => {
    const { user } = await setup(<MessageContacts people={contacts} />);
    for (let index = 0; index < 9; index += 1)
      await user.click(
        screen.getByRole("checkbox", { name: `사람${index} 선택` }),
      );
    expect(screen.getByRole("checkbox", { name: "사람9 선택" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "사람0 선택" })).toBeEnabled();
    fireEvent.change(screen.getByLabelText("그룹 이름 (선택)"), {
      target: { value: "😀".repeat(30) },
    });
    expect(
      screen.getByRole("button", { name: "그룹 만들기 (10명)" }),
    ).toBeEnabled();
    fireEvent.change(screen.getByLabelText("그룹 이름 (선택)"), {
      target: { value: "😀".repeat(31) },
    });
    expect(
      screen.getByRole("button", { name: "그룹 만들기 (10명)" }),
    ).toBeDisabled();
    expect(screen.getByLabelText("그룹 이름 (선택)")).toHaveAttribute(
      "aria-describedby",
    );
  });
  it("does not navigate on a late completion after Activity has been hidden and restored", async () => {
    const pending = Promise.withResolvers<ActionResult<{ roomId: string }>>();
    const open = vi.fn(() => pending.promise);
    const client = new QueryClient();
    const ui = (mode: "visible" | "hidden") => (
      <QueryClientProvider client={client}>
        <Activity mode={mode}>
          <MessageContacts people={contacts} open={open} />
        </Activity>
      </QueryClientProvider>
    );
    const { rerender } = render(ui("visible"));
    fireEvent.click(screen.getByRole("checkbox", { name: "사람0 선택" }));
    fireEvent.click(screen.getByRole("button", { name: "메시지" }));
    await waitFor(() => expect(open).toHaveBeenCalledOnce());
    rerender(ui("hidden"));
    rerender(ui("visible"));
    await act(async () =>
      pending.resolve({ ok: true, data: { roomId: "old" } }),
    );
    expect(router.push).not.toHaveBeenCalled();
  });
});

describe("group management dialogs", () => {
  function DialogHarness({
    initial,
    supplied = actions(),
    candidates = Promise.resolve(contacts),
    memberIds = ["me", "p0"],
  }: {
    initial: NonNullable<GroupDialog>;
    supplied?: GroupActions;
    candidates?: Promise<MessageContact[]>;
    memberIds?: string[];
  }) {
    const [dialog, setDialog] = useState<GroupDialog>(initial);
    return (
      <GroupDialogs
        roomId="group"
        name="기존 이름"
        memberIds={memberIds}
        contacts={candidates}
        dialog={dialog}
        onClose={() => setDialog(null)}
        onReturnFocus={vi.fn()}
        actions={supplied}
      />
    );
  }
  it("renders the fixed add title before contacts, disables existing people, and respects remaining capacity", async () => {
    const pending = Promise.withResolvers<MessageContact[]>();
    const supplied = actions();
    const { user } = await setup(
      <DialogHarness
        initial="add"
        candidates={pending.promise}
        supplied={supplied}
        memberIds={[
          "me",
          ...contacts.slice(0, 8).map((person) => person.userId),
        ]}
      />,
    );
    expect(screen.getByRole("heading", { name: "사람 추가" })).toBeVisible();
    expect(screen.getByRole("status")).toHaveAttribute(
      "aria-label",
      "사람을 불러오고 있어요",
    );
    await act(async () => pending.resolve(contacts));
    expect(
      screen.getByRole("checkbox", { name: "사람0 선택 (참여 중)" }),
    ).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: "사람8 선택" }));
    expect(screen.getByRole("checkbox", { name: "사람9 선택" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "추가" }));
    expect(supplied.add).toHaveBeenCalledExactlyOnceWith({
      roomId: "group",
      userIds: ["p8"],
    });
    expect(router.refresh).toHaveBeenCalledOnce();
  });
  it("renames to a trimmed value, and clearing the name restores the member-derived label", async () => {
    const supplied = actions();
    const { user } = await setup(
      <DialogHarness initial="rename" supplied={supplied} />,
    );
    expect(screen.getByLabelText("그룹 이름")).toHaveValue("기존 이름");
    await user.clear(screen.getByLabelText("그룹 이름"));
    await user.type(screen.getByLabelText("그룹 이름"), " ");
    await user.click(screen.getByRole("button", { name: "저장" }));
    expect(supplied.rename).toHaveBeenCalledExactlyOnceWith({
      roomId: "group",
      name: "",
    });
    expect(router.success).toHaveBeenCalledWith("이름을 바꿨어요");
  });
  it("requires leave confirmation, then navigates to the inbox", async () => {
    const supplied = actions();
    const { user } = await setup(
      <DialogHarness initial="leave" supplied={supplied} />,
    );
    expect(
      screen.getByText("다시 들어오려면 누군가 추가해 줘야 해요"),
    ).toBeVisible();
    expect(supplied.leave).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "그룹 나가기" }));
    expect(supplied.leave).toHaveBeenCalledExactlyOnceWith({ roomId: "group" });
    expect(router.push).toHaveBeenCalledWith("/messages");
    expect(router.success).toHaveBeenCalledWith("그룹에서 나갔어요");
  });
  it("retains the selected people and generic error when a candidate is no longer allowed", async () => {
    const supplied = {
      ...actions(),
      add: vi.fn(async () => ({
        ok: false as const,
        code: "FORBIDDEN" as const,
      })),
    };
    const { user } = await setup(
      <DialogHarness initial="add" supplied={supplied} />,
    );
    await user.click(
      await screen.findByRole("checkbox", { name: "사람1 선택" }),
    );
    await user.click(screen.getByRole("button", { name: "추가" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "이 작업을 할 수 없어요",
    );
    expect(screen.getByRole("checkbox", { name: "사람1 선택" })).toBeChecked();
  });
});

describe("shared group chat screen", () => {
  it("uses the existing chat list, system row and member controls without direct read receipts", async () => {
    const data: DirectMessageView = {
      kind: "group_dm",
      name: "점심 모임",
      displayName: "점심 모임",
      room: {
        id: "group",
        archived: false,
        lastSeq: 1,
        muted: false,
        unreadMentions: 0,
      },
      user: { id: "me", name: "김하은" },
      members: [
        { userId: "me", name: "김하은", username: "haeun", sharesSpace: true },
        {
          userId: "other",
          name: "박지훈",
          username: "jihoon",
          sharesSpace: false,
        },
        {
          userId: "third",
          name: "최서연",
          username: "seoyeon",
          sharesSpace: true,
        },
      ],
      messages: [
        {
          ...emptyMessageDetails(),
          id: "system",
          seq: 1,
          authorId: null,
          authorName: null,
          kind: "system",
          body: "김하은 님이 그룹을 만들었어요",
          systemData: { type: "group_created", actorName: "김하은" },
          createdAt: "2030-01-01T00:00:00Z",
          clientId: null,
        },
      ],
      lastReadSeq: 1,
      firstUnreadSeq: null,
      canWrite: true,
      now: "2030-01-01T01:00:00Z",
    };
    const { user } = await setup(
      <DirectMessageScreen data={data} contacts={Promise.resolve(contacts)} />,
    );
    expect(screen.getByRole("heading", { name: "점심 모임" })).toBeVisible();
    expect(screen.getByRole("combobox", { name: "메시지" })).toHaveAttribute(
      "placeholder",
      "점심 모임에 메시지 보내기",
    );
    expect(screen.queryByText("읽음")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "멤버 3명" }));
    expect(screen.getByRole("button", { name: "사람 추가" })).toBeVisible();
    expect(screen.getByRole("button", { name: "그룹 나가기" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "그룹 더보기" }));
    expect(screen.getByRole("menuitem", { name: "이름 바꾸기" })).toBeVisible();
    expect(
      within(screen.getByRole("article")).queryByRole("toolbar"),
    ).not.toBeInTheDocument();
  });
});
