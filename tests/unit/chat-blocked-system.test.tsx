import { Activity } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { MessageList } from "@/features/chat/components/message-list";
import { emptyMessageDetails, type ChatMessage } from "@/features/chat/types";
import type { MessageActions } from "@/features/chat/components/message-row";
import { foldBlockedMessages } from "@/features/chat/blocked-messages";
import { SystemMessageContent } from "@/features/chat/components/system-message-content";
import { installChatViewport } from "../helpers/chat-viewport";

const now = "2026-10-08T03:00:00Z";
const message = (
  seq: number,
  values: Partial<ChatMessage> = {},
): ChatMessage => ({
  ...emptyMessageDetails(),
  id: `m${seq}`,
  seq,
  authorId: "blocked",
  authorName: "박지훈",
  kind: "text",
  body: `숨긴 내용 ${seq}`,
  createdAt: now,
  clientId: null,
  ...values,
});
const actions: MessageActions = {
  userId: "me",
  canWrite: true,
  canReact: true,
  admin: true,
  names: new Map(),
  react: vi.fn(async () => true),
  onDelete: vi.fn(),
  onReply: vi.fn(),
  onEdit: vi.fn(),
  onReport: vi.fn(),
};
const base = {
  channelName: "일반",
  now,
  userId: "me",
  onRetry: vi.fn(),
  onRemove: vi.fn(),
  actions,
};
let restore: () => void;
beforeEach(() => {
  restore = installChatViewport();
  vi.clearAllMocks();
});
afterEach(() => restore());

describe("blocked message groups", () => {
  it("collapses only adjacent same-author text within five minutes and retains real cursors", () => {
    const rows = [
      message(1),
      message(2),
      message(3, { authorId: "other" }),
      message(4),
      message(5, { createdAt: "2026-10-08T03:06:00Z" }),
      message(6, { kind: "system", authorId: null }),
    ];
    const folded = foldBlockedMessages(rows, ["blocked"], new Set());
    expect(folded.rows.map((row) => row.seq)).toEqual([1, 3, 4, 5, 6]);
    expect(folded.groups.get("m1")).toMatchObject({
      ids: ["m1", "m2"],
      seqs: [1, 2],
      lastSeq: 2,
    });
    expect(
      foldBlockedMessages(rows, ["blocked"], new Set(["m1"])).rows,
    ).toEqual(rows);
  });
  it("hides body, reactions and tools, expands one group only, and folds again after Activity restoration", async () => {
    const rows = [
      message(1),
      message(2),
      message(3, { authorId: "other", body: "보이는 내용" }),
      message(4),
    ];
    const ui = (mode: "visible" | "hidden") => (
      <Activity mode={mode}>
        <MessageList {...base} messages={rows} blockedUserIds={["blocked"]} />
      </Activity>
    );
    const { rerender } = render(ui("visible"));
    const button = screen.getByRole("button", {
      name: "차단한 사용자의 메시지 2개 · 보기",
    });
    expect(screen.queryByText("숨긴 내용 1")).not.toBeInTheDocument();
    fireEvent.mouseEnter(button.closest("article")!);
    expect(
      within(button.closest("article")!).queryByRole("toolbar"),
    ).not.toBeInTheDocument();
    await userEvent.click(button);
    expect(screen.getByText("숨긴 내용 1")).toBeVisible();
    expect(screen.getByText("숨긴 내용 2")).toBeVisible();
    expect(screen.queryByText("숨긴 내용 4")).not.toBeInTheDocument();
    rerender(ui("hidden"));
    rerender(ui("visible"));
    expect(screen.queryByText("숨긴 내용 1")).not.toBeInTheDocument();
  });
  it("keeps unread and reply jumps inside a collapsed group without loading or revealing it", async () => {
    const load = vi.fn(async () => {});
    const viewport = vi.fn();
    const { container } = render(
      <MessageList
        {...base}
        messages={[message(1), message(2), message(3)]}
        blockedUserIds={["blocked"]}
        firstUnreadSeq={2}
        jumpToId="m2"
        hasMore
        onLoadOlder={load}
        onViewport={viewport}
      />,
    );
    await waitFor(() =>
      expect(
        container.querySelector('[data-message-id="m1"] article'),
      ).toHaveFocus(),
    );
    expect(screen.queryByText("숨긴 내용 2")).not.toBeInTheDocument();
    expect(container.querySelector("[data-unread-divider]")).toHaveTextContent(
      "새 메시지",
    );
    expect(viewport).toHaveBeenCalledWith(true, 3, 3);
    expect(load).not.toHaveBeenCalledWith(500);
  });
  it("never announces the blocked body to assistive technology", async () => {
    const first = [message(1)];
    const { rerender, container } = render(
      <MessageList {...base} messages={first} blockedUserIds={["blocked"]} />,
    );
    await act(async () =>
      rerender(
        <MessageList
          {...base}
          messages={[...first, message(2)]}
          blockedUserIds={["blocked"]}
          liveMessages={[message(2)]}
        />,
      ),
    );
    expect(
      container.querySelector("[data-chat-announcement]"),
    ).toHaveTextContent("차단한 사용자의 새 메시지");
    expect(
      container.querySelector("[data-chat-announcement]"),
    ).not.toHaveTextContent("숨긴 내용");
  });
});

describe("system messages and reports", () => {
  it.each([
    [
      { type: "group_created", actorName: "김하은" },
      "김하은 님이 그룹을 만들었어요",
    ],
    [
      { type: "members_added", actorName: "김하은", names: ["박지훈"] },
      "김하은 님이 박지훈 님을 추가했어요",
    ],
    [{ type: "member_left", name: "박지훈" }, "박지훈 님이 나갔어요"],
    [
      { type: "room_renamed", actorName: "김하은", name: "디자인" },
      "김하은 님이 그룹 이름을 '디자인'(으)로 바꿨어요",
    ],
    [{ type: "unknown" }, "이전 버전의 문장"],
  ])("renders the system payload or literal fallback: %j", (data, text) => {
    render(
      <SystemMessageContent
        data={data}
        body="이전 버전의 문장"
        createdAt={now}
      />,
    );
    expect(screen.getByText(text)).toBeVisible();
  });
  it("keeps a system message keyboard reachable without any message tools", async () => {
    render(
      <MessageList
        {...base}
        messages={[
          message(1, {
            kind: "system",
            authorId: null,
            systemData: { type: "group_created", actorName: "김하은" },
            reactions: [
              { emoji: "heart", count: 1, mine: false, names: ["박지훈"] },
            ],
          }),
        ]}
      />,
    );
    fireEvent.keyDown(screen.getByRole("region"), { key: "ArrowDown" });
    await waitFor(() => expect(screen.getByRole("article")).toHaveFocus());
    fireEvent.keyDown(screen.getByRole("article"), { key: "Enter" });
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /리액션|신고|답장/ }),
    ).not.toBeInTheDocument();
  });
  it("offers reporting only on another person's non-deleted text", async () => {
    render(
      <MessageList
        {...base}
        messages={[
          message(1),
          message(2, { authorId: "me" }),
          message(3, { deletedAt: now }),
        ]}
      />,
    );
    const [other, own, deleted] = screen.getAllByRole("article");
    fireEvent.mouseEnter(other!);
    await userEvent.click(
      within(other!).getByRole("button", { name: "메시지 더보기" }),
    );
    await userEvent.click(screen.getByRole("menuitem", { name: "신고" }));
    expect(actions.onReport).toHaveBeenCalledWith(
      expect.objectContaining({ id: "m1" }),
    );
    for (const row of [own, deleted]) {
      fireEvent.mouseEnter(row!);
      expect(within(row!).queryByText("신고")).not.toBeInTheDocument();
    }
  });
});
