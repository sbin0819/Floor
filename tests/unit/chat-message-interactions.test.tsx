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
import { useState } from "react";
import { MessageList } from "@/features/chat/components/message-list";
import { MessageDeleteDialog } from "@/features/chat/components/message-delete-dialog";
import type { MessageActions } from "@/features/chat/components/message-row";
import { emptyMessageDetails } from "@/features/chat/types";
import type { DisplayMessage } from "@/features/chat/components/message-state";
import { installChatViewport } from "../helpers/chat-viewport";

const now = "2026-10-08T03:00:00Z";
function message(
  seq: number,
  values: Partial<DisplayMessage> = {},
): DisplayMessage {
  return {
    ...emptyMessageDetails(),
    id: `m-${seq}`,
    seq,
    body: `메시지 ${seq}`,
    authorId: "other",
    authorName: "이서연",
    kind: "text",
    clientId: null,
    createdAt: now,
    ...values,
  };
}
function actions(values: Partial<MessageActions> = {}): MessageActions {
  return {
    userId: "me",
    canWrite: true,
    canReact: true,
    admin: true,
    names: new Map(),
    react: vi.fn(async () => true),
    onDelete: vi.fn(),
    onReply: vi.fn(),
    onEdit: vi.fn(),
    ...values,
  };
}
function draw(messages: DisplayMessage[], values = actions()) {
  return render(
    <MessageList
      messages={messages}
      channelName="일반"
      now={now}
      userId="me"
      actions={values}
      onRetry={vi.fn()}
      onRemove={vi.fn()}
    />,
  );
}
let restore: () => void;
beforeEach(() => {
  restore = installChatViewport();
});
afterEach(() => {
  restore();
  vi.useRealTimers();
});

describe("message row interactions", () => {
  it("opens on hover or keyboard, supports roving arrows, and closes the tools with Escape", async () => {
    draw([message(1), message(2)]);
    const region = screen.getByRole("region", { name: "일반 메시지" });
    fireEvent.keyDown(region, { key: "ArrowUp" });
    const rows = screen.getAllByRole("article");
    await waitFor(() => expect(rows[1]).toHaveFocus());
    expect(rows[1]).toHaveAttribute("tabindex", "0");
    expect(rows[0]).toHaveAttribute("tabindex", "-1");
    fireEvent.keyDown(rows[1]!, { key: "ArrowUp" });
    await waitFor(() => expect(rows[0]).toHaveFocus());
    fireEvent.keyDown(rows[0]!, { key: "Enter" });
    await waitFor(() =>
      expect(
        within(rows[0]!).getByRole("button", { name: "👍 좋아요 추가" }),
      ).toHaveFocus(),
    );
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(rows[0]).toHaveFocus();
    expect(rows[0]!.querySelector("[data-message-toolbar]")).toHaveClass(
      "invisible",
    );
    fireEvent.mouseEnter(rows[1]!);
    expect(within(rows[1]!).getByRole("toolbar")).toBeVisible();
  });

  it("keeps the focused offscreen article mounted after a wheel scroll", async () => {
    const { container } = draw(
      Array.from({ length: 150 }, (_, index) => message(index + 1)),
    );
    const region = screen.getByRole("region", { name: "일반 메시지" });
    fireEvent.keyDown(region, { key: "ArrowUp" });
    const row = container.querySelector<HTMLElement>(
      '[data-message-id="m-150"] article',
    )!;
    await waitFor(() => expect(row).toHaveFocus());
    act(() => {
      region.scrollTop = 0;
      fireEvent.scroll(region);
    });
    await waitFor(() =>
      expect(
        container.querySelector('[data-message-id="m-1"]'),
      ).toBeInTheDocument(),
    );
    expect(row).toBeInTheDocument();
    expect(row).toHaveFocus();
    expect(container.querySelectorAll("[data-message-id]").length).toBeLessThan(
      30,
    );
  });

  it("opens touch actions only after a still long press and cancels a scrolling press", () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "PointerEvent",
      class extends MouseEvent {
        pointerType: string;
        constructor(type: string, options: PointerEventInit = {}) {
          super(type, options);
          this.pointerType = options.pointerType ?? "";
        }
      },
    );
    draw([message(1)]);
    const row = screen.getByRole("article");
    fireEvent.pointerDown(row, {
      pointerType: "touch",
      clientX: 0,
      clientY: 0,
    });
    fireEvent.pointerMove(row, {
      pointerType: "touch",
      clientX: 0,
      clientY: 20,
    });
    act(() => vi.advanceTimersByTime(600));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.pointerDown(row, {
      pointerType: "touch",
      clientX: 0,
      clientY: 0,
    });
    act(() => vi.advanceTimersByTime(500));
    expect(screen.getByRole("dialog", { name: "메시지 동작" })).toBeVisible();
  });

  it("renders safe formatting, mentions, and deleted placeholders without leaked body or reactions", () => {
    const { rerender } = draw([
      message(1, {
        body: "**굵게** <script>bad()</script>",
        mentions: [{ userId: "me", name: "박지훈" }],
        reactions: [
          { emoji: "heart", count: 1, mine: true, names: ["박지훈"] },
        ],
      }),
    ]);
    expect(screen.getByText("굵게").tagName).toBe("STRONG");
    expect(document.querySelector("script")).not.toBeInTheDocument();
    expect(screen.getByRole("article")).toHaveAttribute(
      "data-mentioned",
      "true",
    );
    rerender(
      <MessageList
        messages={[message(1, { body: "", deletedAt: now })]}
        channelName="일반"
        now={now}
        userId="me"
        actions={actions()}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByText("삭제된 메시지예요")).toHaveClass("italic");
    expect(screen.queryByText("굵게")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("group", { name: "메시지 반응" }),
    ).not.toBeInTheDocument();
  });

  it("confirms an administrator deleting somebody else's message and restores row focus", async () => {
    const remove = vi.fn(async () => true);
    function View() {
      const [target, setTarget] = useState<DisplayMessage | null>(null);
      return (
        <>
          <MessageList
            messages={[message(1)]}
            channelName="일반"
            now={now}
            userId="me"
            actions={actions({ onDelete: setTarget })}
            onRetry={vi.fn()}
            onRemove={vi.fn()}
          />
          <MessageDeleteDialog
            message={target}
            userId="me"
            onClose={() => setTarget(null)}
            onDelete={remove}
            onReturnFocus={() => screen.getByRole("article").focus()}
          />
        </>
      );
    }
    render(<View />);
    const row = screen.getByRole("article");
    fireEvent.mouseEnter(row);
    await userEvent.click(
      screen.getByRole("button", { name: "메시지 더보기" }),
    );
    await userEvent.click(screen.getByRole("menuitem", { name: "삭제" }));
    expect(
      screen.getByRole("dialog", { name: "메시지를 지울까요?" }),
    ).toBeVisible();
    expect(
      screen.getByText(/이 메시지는 이서연 님의 메시지예요/),
    ).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "지우기" }));
    expect(remove).toHaveBeenCalledWith("m-1");
    await waitFor(() => expect(row).toHaveFocus());
  });
});
