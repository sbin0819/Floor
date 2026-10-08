import { useRef, useState } from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  MessageActionsSheet,
  MessageToolbar,
  type MessageToolbarProps,
} from "@/features/chat/components/message-toolbar";
import { ReactionPills } from "@/features/chat/components/reaction-pills";
import { reactionPeople } from "@/features/chat/reaction-labels";
import type { ChatReaction } from "@/features/chat/types";

beforeEach(() => {
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

function props(
  overrides: Partial<MessageToolbarProps> = {},
): MessageToolbarProps {
  return {
    canReact: true,
    canReply: true,
    canEdit: false,
    canDelete: false,
    onReaction: vi.fn(),
    onReply: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
}

function drawToolbar(values: MessageToolbarProps) {
  return render(
    <TooltipProvider>
      <MessageToolbar {...values} />
    </TooltipProvider>,
  );
}

describe("controlled message actions", () => {
  it("renders the three quick reactions and 44px accessible actions", async () => {
    const onReaction = vi.fn();
    drawToolbar(props({ onReaction }));
    expect(screen.getByRole("toolbar", { name: "메시지 도구" })).toBeVisible();
    for (const label of [
      "👍 좋아요 추가",
      "❤️ 하트 추가",
      "🎉 축하 추가",
      "답장",
    ])
      expect(screen.getByRole("button", { name: label })).toHaveClass(
        "size-11",
      );
    await userEvent.click(
      screen.getByRole("button", { name: "👍 좋아요 추가" }),
    );
    expect(onReaction).toHaveBeenCalledWith("thumbs_up", true);
  });

  it("does not infer edit or delete authority, and hides all actions when unavailable", () => {
    const { rerender } = drawToolbar(props());
    expect(
      screen.queryByRole("button", { name: "수정" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "메시지 더보기" }),
    ).not.toBeInTheDocument();
    rerender(
      <TooltipProvider>
        <MessageToolbar {...props({ canReact: false, canReply: false })} />
      </TooltipProvider>,
    );
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
  });

  it("uses controlled current reactions when cancelling a quick reaction", async () => {
    const onReaction = vi.fn();
    drawToolbar(
      props({
        onReaction,
        reactions: [{ emoji: "heart", count: 2, mine: true, names: [] }],
      }),
    );
    const button = screen.getByRole("button", { name: "❤️ 하트 취소" });
    expect(button).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(button);
    expect(onReaction).toHaveBeenCalledWith("heart", false);
    expect(button).toHaveAttribute("aria-pressed", "true");
  });

  it("offers exactly eight reactions and restores the picker trigger after selection", async () => {
    const onReaction = vi.fn();
    drawToolbar(props({ onReaction }));
    const trigger = screen.getByRole("button", { name: "리액션 고르기" });
    await userEvent.click(trigger);
    const picker = screen.getByRole("group", { name: "리액션 고르기" });
    expect(within(picker).getAllByRole("button")).toHaveLength(8);
    await userEvent.click(
      within(picker).getByRole("button", { name: "🙏 감사 추가" }),
    );
    expect(onReaction).toHaveBeenCalledWith("pray", true);
    await waitFor(() =>
      expect(
        screen.queryByRole("group", { name: "리액션 고르기" }),
      ).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("opens tooltips from keyboard focus and calls only explicitly allowed actions", async () => {
    const values = props({ canEdit: true });
    drawToolbar(values);
    const edit = screen.getByRole("button", { name: "수정" });
    fireEvent.focus(edit);
    expect(await screen.findByRole("tooltip", { name: "수정" })).toBeVisible();
    await userEvent.click(edit);
    await userEvent.click(screen.getByRole("button", { name: "답장" }));
    expect(values.onEdit).toHaveBeenCalledOnce();
    expect(values.onReply).toHaveBeenCalledOnce();
  });

  it("disables actions during a parent-controlled busy state", async () => {
    const values = props({ canEdit: true, canDelete: true, disabled: true });
    drawToolbar(values);
    for (const button of screen.getAllByRole("button"))
      expect(button).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "수정" }));
    expect(values.onEdit).not.toHaveBeenCalled();
  });

  it("does not let a closing delete menu steal the confirmation dialog focus", async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <TooltipProvider>
          <MessageToolbar
            {...props({ canDelete: true, onDelete: () => setOpen(true) })}
          />
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent>
              <DialogTitle>메시지를 지울까요?</DialogTitle>
              <DialogDescription>삭제 확인</DialogDescription>
              <button type="button">취소</button>
            </DialogContent>
          </Dialog>
        </TooltipProvider>
      );
    }
    render(<Harness />);
    await userEvent.click(
      screen.getByRole("button", { name: "메시지 더보기" }),
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "삭제" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "취소" })).toHaveFocus(),
    );
  });

  it("closes the parent toolbar on Escape only when no picker is open", async () => {
    const onEscape = vi.fn();
    drawToolbar(props({ onEscape }));
    fireEvent.keyDown(screen.getByRole("toolbar"), { key: "Escape" });
    expect(onEscape).toHaveBeenCalledOnce();
    await userEvent.click(
      screen.getByRole("button", { name: "리액션 고르기" }),
    );
    fireEvent.keyDown(screen.getByRole("toolbar"), { key: "Escape" });
    expect(onEscape).toHaveBeenCalledOnce();
  });

  it("uses a controlled bottom sheet and returns focus to its owning message on dismiss", async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      const trigger = useRef<HTMLButtonElement>(null);
      return (
        <TooltipProvider>
          <button ref={trigger} onClick={() => setOpen(true)}>
            메시지
          </button>
          <MessageActionsSheet
            {...props({ canEdit: true, canDelete: true })}
            open={open}
            onOpenChange={setOpen}
            onReturnFocus={() => trigger.current?.focus()}
          />
        </TooltipProvider>
      );
    }
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "메시지" }));
    const sheet = screen.getByRole("dialog", { name: "메시지 동작" });
    expect(sheet).toHaveAttribute("data-side", "bottom");
    expect(within(sheet).getAllByRole("button")).toHaveLength(12);
    await userEvent.click(
      screen.getByRole("button", { name: "메시지 동작 닫기" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "메시지" })).toHaveFocus(),
    );
  });

  it("passes a chosen sheet reaction once and does not execute disabled actions", async () => {
    const onReaction = vi.fn();
    const onOpenChange = vi.fn();
    const values = props({ onReaction });
    const { rerender } = render(
      <TooltipProvider>
        <MessageActionsSheet {...values} open onOpenChange={onOpenChange} />
      </TooltipProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "✅ 확인 추가" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onReaction).toHaveBeenCalledExactlyOnceWith("check", true);
    rerender(
      <TooltipProvider>
        <MessageActionsSheet
          {...values}
          disabled
          open
          onOpenChange={onOpenChange}
        />
      </TooltipProvider>,
    );
    expect(screen.getByRole("button", { name: "✅ 확인 추가" })).toBeDisabled();
  });
});

describe("reaction pills", () => {
  const reactions: ChatReaction[] = [
    {
      emoji: "thumbs_up",
      count: 3,
      mine: true,
      names: ["김하은", "이서연", "박지훈"],
    },
  ];
  it("describes the count and my selection and does not create its own optimistic state", async () => {
    const onChange = vi.fn();
    render(
      <TooltipProvider>
        <ReactionPills reactions={reactions} onChange={onChange} />
      </TooltipProvider>,
    );
    const button = screen.getByRole("button", {
      name: "👍 3명, 나 포함. 누르면 취소",
    });
    expect(button).toHaveClass("h-11");
    await userEvent.click(button);
    expect(onChange).toHaveBeenCalledExactlyOnceWith("thumbs_up", false);
    expect(button).toHaveAttribute("aria-pressed", "true");
  });

  it("shows names on focus and controlled updates change the action label", async () => {
    const { rerender } = render(
      <TooltipProvider>
        <ReactionPills reactions={reactions} onChange={vi.fn()} />
      </TooltipProvider>,
    );
    fireEvent.focus(screen.getByRole("button"));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "김하은, 이서연, 박지훈",
    );
    rerender(
      <TooltipProvider>
        <ReactionPills
          reactions={[{ ...reactions[0]!, count: 2, mine: false }]}
          onChange={vi.fn()}
        />
      </TooltipProvider>,
    );
    expect(
      screen.getByRole("button", { name: "👍 2명. 누르면 추가" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("omits empty reactions and respects the disabled state", () => {
    const { rerender } = render(
      <TooltipProvider>
        <ReactionPills reactions={[]} onChange={vi.fn()} />
      </TooltipProvider>,
    );
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
    rerender(
      <TooltipProvider>
        <ReactionPills reactions={reactions} disabled onChange={vi.fn()} />
      </TooltipProvider>,
    );
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("lists at most ten known names with the remaining count", () => {
    const names = Array.from({ length: 12 }, (_, i) => `사람${i + 1}`);
    expect(reactionPeople(15, names)).toBe(
      `${names.slice(0, 10).join(", ")} 외 5명`,
    );
    expect(reactionPeople(3, [])).toBe("3명이 반응했어요");
  });
});
