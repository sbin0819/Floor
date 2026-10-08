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
import { MessageList } from "@/features/chat/components/message-list";
import { emptyMessageDetails } from "@/features/chat/types";
import type { DisplayMessage } from "@/features/chat/components/message-state";
import type { MessageActions } from "@/features/chat/components/message-row";
import { installChatViewport } from "../helpers/chat-viewport";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
const mentionedId = "00000000-0000-4000-8000-000000000009";
const now = "2026-10-08T03:00:00Z";
function message(values: Partial<DisplayMessage> = {}): DisplayMessage {
  return {
    authorAvatar: { color: "blue" as const, photoUrl: null },
    ...emptyMessageDetails(),
    id: "m1",
    clientId: null,
    seq: 1,
    kind: "text",
    authorId: "other",
    authorName: "이서연",
    body: "복사할 내용",
    createdAt: now,
    ...values,
  };
}
function draw(value = message(), actions?: MessageActions) {
  return render(
    <MessageList
      messages={[value]}
      userId="me"
      channelName="일반"
      now={now}
      onRetry={vi.fn()}
      onRemove={vi.fn()}
      actions={actions}
    />,
  );
}
let restore: () => void;
beforeEach(() => {
  restore = installChatViewport();
  vi.clearAllMocks();
});
afterEach(() => {
  restore();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("bubble copy and responsive tools", () => {
  it("keeps an inaccessible time measurement slot when the next message hides the clock", () => {
    render(
      <MessageList
        messages={[message(), message({ id: "m2", seq: 2 })]}
        userId="me"
        channelName="일반"
        now={now}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    const first = screen.getAllByRole("article")[0]!;
    expect(first).toHaveAttribute("data-show-time", "false");
    expect(first.querySelector("[data-message-time]")).toBeNull();
    const measure = first.querySelector("[data-message-time-measure]");
    expect(measure).toHaveAttribute("aria-hidden", "true");
    expect(measure).toHaveClass("invisible", "col-start-1", "row-start-1");
    expect(measure).toHaveTextContent("오후 12:00");
    expect(first.querySelector("[data-message-time-slot]")).toHaveClass(
      "grid",
      "shrink-0",
    );
  });
  it("opens copy-only actions by keyboard in a readonly room without action callbacks", async () => {
    const user = userEvent.setup();
    const write = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue();
    draw(
      message({
        body: `**<@${mentionedId}>**\n<@everyone>`,
        mentions: [{ userId: mentionedId, name: "김하은" }],
      }),
    );
    const row = screen.getByRole("article");
    fireEvent.keyDown(row, { key: "Enter" });
    const more = within(row).getByRole("button", { name: "메시지 더보기" });
    await waitFor(() => expect(more).toHaveFocus());
    await user.click(more);
    expect(screen.getAllByRole("menuitem")).toHaveLength(1);
    await user.click(screen.getByRole("menuitem", { name: "본문 복사" }));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("복사했어요"),
    );
    expect(write).toHaveBeenCalledExactlyOnceWith("**@김하은**\n@모두");
    await waitFor(() => expect(more).toHaveFocus());
  });

  it("keeps the original body and reports a fixed error when clipboard access fails", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(
      new Error("private clipboard detail"),
    );
    draw();
    fireEvent.mouseEnter(screen.getByRole("article"));
    await user.click(screen.getByRole("button", { name: "메시지 더보기" }));
    await user.click(screen.getByRole("menuitem", { name: "본문 복사" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledExactlyOnceWith("복사하지 못했어요"),
    );
    expect(screen.getByText("복사할 내용")).toBeVisible();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it.each([
    message({
      body: "",
      attachments: [
        {
          id: "file",
          name: "자료.pdf",
          kind: "file",
          size: 1,
          width: null,
          height: null,
        },
      ],
    }),
    message({ body: "", deletedAt: now }),
    message({ kind: "system", body: "시스템 안내" }),
  ])(
    "does not offer copy on attachment-only, deleted, or system rows: $kind / $deletedAt",
    (value) => {
      draw(value);
      fireEvent.mouseEnter(screen.getByRole("article"));
      fireEvent.keyDown(screen.getByRole("article"), { key: "Enter" });
      expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
      expect(screen.queryByText("본문 복사")).not.toBeInTheDocument();
    },
  );

  it.each([false, true])(
    "anchors outside the bubble at 960px and above it below 960px: mine=%s",
    (mine) => {
      draw(message({ authorId: mine ? "me" : "other" }));
      const row = screen.getByRole("article");
      const toolbar = row.querySelector("[data-message-toolbar]")!;
      const anchor = toolbar.parentElement!;
      expect(anchor.querySelector("[data-message-bubble]")).not.toBeNull();
      expect(toolbar).toHaveClass("absolute", "-top-10", "@min-[960px]:top-0");
      expect(toolbar).toHaveClass(mine ? "right-0" : "left-0");
      expect(toolbar).toHaveClass(
        mine ? "@min-[960px]:right-full" : "@min-[960px]:left-full",
      );
      expect(toolbar).toHaveClass("invisible");
      fireEvent.mouseEnter(row);
      expect(toolbar).not.toHaveClass("invisible");
      expect(row.querySelector("[data-message-time]")).toHaveClass(
        "@min-[960px]:invisible",
      );
      fireEvent.mouseLeave(row);
      expect(row.querySelector("[data-message-time]")).not.toHaveClass(
        "@min-[960px]:invisible",
      );
    },
  );

  it("offers copy in the touch sheet and restores focus without moving to another dialog", async () => {
    const user = userEvent.setup();
    const write = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue();
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
    vi.useFakeTimers();
    draw();
    const row = screen.getByRole("article");
    fireEvent.pointerDown(row, {
      pointerType: "touch",
      clientX: 20,
      clientY: 20,
    });
    act(() => vi.advanceTimersByTime(500));
    vi.useRealTimers();
    const dialog = screen.getByRole("dialog", { name: "메시지 동작" });
    await user.click(within(dialog).getByRole("button", { name: "본문 복사" }));
    await waitFor(() =>
      expect(write).toHaveBeenCalledExactlyOnceWith("복사할 내용"),
    );
    await waitFor(() => expect(row).toHaveFocus());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
