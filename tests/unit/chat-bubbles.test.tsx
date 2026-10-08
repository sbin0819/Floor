import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MessageList } from "@/features/chat/components/message-list";
import {
  MessageRow,
  type MessageActions,
} from "@/features/chat/components/message-row";
import type { DisplayMessage } from "@/features/chat/components/message-state";
import {
  emptyMessageDetails,
  type ChatAttachment,
} from "@/features/chat/types";
import { installChatViewport } from "../helpers/chat-viewport";

const me = "a0000000-0000-4000-8000-000000000001";
const other = "a0000000-0000-4000-8000-000000000002";
const now = "2026-10-08T04:00:00.000Z";
const attachment: ChatAttachment = {
  id: "b0000000-0000-4000-8000-000000000001",
  name: "회의 자료.pdf",
  size: 2048,
  kind: "file",
  width: null,
  height: null,
};

function message(
  seq: number,
  values: Partial<DisplayMessage> = {},
): DisplayMessage {
  return {
    authorAvatar: { color: "blue" as const, photoUrl: null },
    ...emptyMessageDetails(),
    id: `message-${seq}`,
    seq,
    kind: "text",
    body: `본문 ${seq}`,
    authorId: other,
    authorName: "이서연",
    clientId: null,
    createdAt: "2026-10-08T00:12:00.000Z",
    ...values,
  };
}

function actions(values: Partial<MessageActions> = {}): MessageActions {
  return {
    userId: me,
    canWrite: true,
    canReact: true,
    admin: false,
    filesEnabled: true,
    names: new Map([
      [me, "박지훈"],
      [other, "이서연"],
    ]),
    react: vi.fn(async () => true),
    onDelete: vi.fn(),
    onEdit: vi.fn(),
    onReply: vi.fn(),
    onJump: vi.fn(),
    ...values,
  };
}

type ListOverrides = Partial<ComponentProps<typeof MessageList>>;
function list(messages: DisplayMessage[], values: ListOverrides = {}) {
  return (
    <MessageList
      messages={messages}
      channelName="일반"
      now={now}
      userId={me}
      onRetry={vi.fn()}
      onRemove={vi.fn()}
      {...values}
    />
  );
}
async function draw(messages: DisplayMessage[], values: ListOverrides = {}) {
  const result = render(list(messages, values));
  await waitFor(() =>
    expect(screen.getAllByRole("article")).toHaveLength(messages.length),
  );
  return result;
}
function drawRow(
  value: DisplayMessage,
  values: Partial<ComponentProps<typeof MessageRow>> = {},
) {
  return render(
    <TooltipProvider>
      <MessageRow
        message={value}
        grouped={false}
        mine={value.authorId === me}
        runStart
        runEnd
        showTime
        dateDivider={false}
        unread={false}
        now={now}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
        actions={actions()}
        {...values}
      />
    </TooltipProvider>,
  );
}
function element(parent: ParentNode, selector: string) {
  const found = parent.querySelector<HTMLElement>(selector);
  expect(found).not.toBeNull();
  return found!;
}
function bubble(row: HTMLElement) {
  return element(row, "[data-message-bubble]");
}
function row(id: string) {
  return element(document, `[data-message-id="${id}"] article`);
}
function shownTimes() {
  return screen
    .getAllByRole("article")
    .map((article) => article.getAttribute("data-show-time"));
}

let restore: () => void;
beforeEach(() => {
  restore = installChatViewport();
});
afterEach(() => restore());

describe("chat bubble direction and grouping", () => {
  it.each([undefined, "pending", "failed"] as const)(
    "places my %s message on the right without visible identity, including readonly lists",
    async (delivery) => {
      await draw([
        message(1, { authorId: me, authorName: "박지훈", delivery }),
      ]);
      const article = screen.getByRole("article", {
        name: "박지훈, 오전 9:12",
      });
      expect(article).toHaveAttribute("data-side", "mine");
      expect(article).toHaveClass("justify-end");
      expect(
        within(article).queryByRole("button", { name: /프로필/ }),
      ).toBeNull();
      expect(within(article).queryByText("박지훈")).toBeNull();
      expect(bubble(article)).toHaveClass(
        delivery ? "bg-chat-pending" : "bg-chat-mine",
        delivery ? "text-chat-pending-foreground" : "text-chat-mine-foreground",
      );
    },
  );

  it("shows another person's identity only at the beginning of each five-minute run", async () => {
    await draw([
      message(1),
      message(2, { createdAt: "2026-10-08T00:16:59.000Z" }),
      message(3, { createdAt: "2026-10-08T00:22:00.000Z" }),
    ]);
    const rows = screen.getAllByRole("article");
    expect(rows.map((article) => article.dataset.runStart)).toEqual([
      "true",
      "false",
      "true",
    ]);
    for (const article of rows)
      expect(article).toHaveAttribute("data-side", "other");
    expect(
      screen.getAllByRole("button", { name: "이서연 아바타 프로필" }),
    ).toHaveLength(2);
    expect(
      screen.getAllByRole("button", { name: "이서연 프로필" }),
    ).toHaveLength(2);
    expect(bubble(rows[0]!)).toHaveClass(
      "bg-card",
      "border",
      "text-foreground",
    );
    expect(
      within(rows[1]!).queryByRole("button", { name: /프로필/ }),
    ).toBeNull();
  });

  it("shows the time only on the last of three messages from the same minute", async () => {
    await draw([
      message(1),
      message(2, { createdAt: "2026-10-08T00:12:20.000Z" }),
      message(3, { createdAt: "2026-10-08T00:12:59.999Z" }),
    ]);
    expect(shownTimes()).toEqual(["false", "false", "true"]);
    expect(document.querySelectorAll("article time")).toHaveLength(1);
    expect(row("message-3").querySelector("time")).toHaveTextContent(
      "오전 9:12",
    );
  });

  it("ends a visible timestamp at the exact minute boundary without ending the five-minute run", async () => {
    await draw([
      message(1, { createdAt: "2026-10-08T00:12:59.999Z" }),
      message(2, { createdAt: "2026-10-08T00:13:00.000Z" }),
      message(3, { createdAt: "2026-10-08T00:13:59.999Z" }),
    ]);
    expect(shownTimes()).toEqual(["true", "false", "true"]);
    expect(row("message-2")).toHaveAttribute("data-run-start", "false");
    expect(row("message-1").querySelector("time")).toHaveTextContent(
      "오전 9:12",
    );
    expect(row("message-3").querySelector("time")).toHaveTextContent(
      "오전 9:13",
    );
  });

  it("keeps each author's time when somebody else interrupts the run", async () => {
    await draw([
      message(1),
      message(2, { authorId: me, authorName: "박지훈" }),
      message(3),
    ]);
    expect(shownTimes()).toEqual(["true", "true", "true"]);
    expect(
      screen.getAllByRole("article").map((article) => article.dataset.runStart),
    ).toEqual(["true", "true", "true"]);
  });

  it("does not let a system message suppress the preceding person's time", async () => {
    await draw([
      message(1),
      message(2, {
        kind: "system",
        authorId: null,
        authorName: null,
        body: "통화가 끝났어요",
      }),
      message(3),
    ]);
    expect(row("message-1")).toHaveAttribute("data-show-time", "true");
    expect(row("message-2").querySelector("[data-message-bubble]")).toBeNull();
    expect(element(row("message-2"), "[data-system-message]")).toHaveClass(
      "justify-center",
    );
    expect(row("message-3")).toHaveAttribute("data-run-start", "true");
  });

  it("repeats another person's identity immediately after the unread divider", async () => {
    await draw([message(1), message(2), message(3)], { firstUnreadSeq: 2 });
    expect(row("message-2")).toHaveAttribute("data-run-start", "true");
    expect(
      within(row("message-2")).getByRole("button", { name: "이서연 프로필" }),
    ).toBeVisible();
    const divider = element(document, "[data-unread-divider]");
    expect(divider.parentElement).toContainElement(row("message-2"));
    expect(
      divider.compareDocumentPosition(row("message-2")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("updates the former last message's time and corner after appending a continuation", async () => {
    const first = message(1, { authorId: me, authorName: "박지훈" });
    const result = await draw([first]);
    const original = row(first.id);
    expect(original).toHaveAttribute("data-show-time", "true");
    expect(bubble(original)).toHaveClass("rounded-br-[6px]");
    result.rerender(
      list([
        first,
        message(2, {
          authorId: me,
          authorName: "박지훈",
          createdAt: "2026-10-08T00:12:30.000Z",
        }),
      ]),
    );
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(2));
    expect(row(first.id)).toBe(original);
    expect(original).toHaveAttribute("data-show-time", "false");
    expect(original.querySelector("time")).toBeNull();
    expect(bubble(original)).not.toHaveClass("rounded-br-[6px]");
    expect(bubble(row("message-2"))).toHaveClass("rounded-br-[6px]");
  });
});

describe("chat bubble content and state", () => {
  it("shows edited metadata with or without the end-of-minute timestamp outside the bubble", async () => {
    await draw([
      message(1, { editedAt: now }),
      message(2, { createdAt: "2026-10-08T00:12:30.000Z", editedAt: now }),
    ]);
    const first = row("message-1");
    const last = row("message-2");
    expect(element(first, "[data-message-time]")).toHaveTextContent(/^수정됨$/);
    expect(element(last, "[data-message-time]")).toHaveTextContent(
      "수정됨 · 오전 9:12",
    );
    expect(bubble(first)).not.toContainElement(
      element(first, "[data-message-time]"),
    );
    expect(bubble(last)).not.toContainElement(
      element(last, "[data-message-time]"),
    );
  });

  it("places a clickable original excerpt inside the bubble without a reply avatar", () => {
    const onJump = vi.fn();
    drawRow(
      message(2, {
        replyTo: {
          id: "original",
          authorName: "박지훈",
          excerpt: "원래 본문",
          deleted: false,
          attachmentSummary: null,
        },
      }),
      { actions: actions({ onJump }) },
    );
    const article = screen.getByRole("article");
    const reply = within(article).getByRole("button", {
      name: "박지훈 님의 원문: 원래 본문",
    });
    expect(bubble(article)).toContainElement(reply);
    expect(reply.querySelector(".rounded-full")).toBeNull();
    fireEvent.click(reply);
    expect(onJump).toHaveBeenCalledExactlyOnceWith("original");
  });

  it("renders attachment-only messages without an empty bubble and with metadata by the cards", () => {
    drawRow(
      message(1, {
        authorId: me,
        authorName: "박지훈",
        body: "",
        attachments: [attachment],
      }),
    );
    const article = screen.getByRole("article");
    expect(article.querySelector("[data-message-bubble]")).toBeNull();
    const cards = element(article, "[data-message-attachments]");
    expect(cards).toContainElement(screen.getByText(attachment.name));
    expect(cards).toContainElement(element(article, "[data-message-time]"));
    expect(
      within(article).getByRole("link", {
        name: `${attachment.name} 내려받기`,
      }),
    ).toHaveAttribute("href", `/api/files/${attachment.id}?download=1`);
  });

  it("keeps a reply-only bubble above attachment cards when the body is empty", () => {
    drawRow(
      message(1, {
        body: "",
        attachments: [attachment],
        replyTo: {
          id: "original",
          authorName: "박지훈",
          excerpt: "첨부할게요",
          deleted: false,
          attachmentSummary: null,
        },
      }),
    );
    const article = screen.getByRole("article");
    const reply = within(article).getByRole("button", {
      name: "박지훈 님의 원문: 첨부할게요",
    });
    expect(bubble(article)).toContainElement(reply);
    const cards = element(article, "[data-message-attachments]");
    expect(bubble(article)).not.toContainElement(cards);
    expect(
      bubble(article).compareDocumentPosition(cards) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("keeps attachments, reactions and the DM read receipt in my same right-aligned content column", () => {
    drawRow(
      message(1, {
        authorId: me,
        authorName: "박지훈",
        attachments: [attachment],
        reactions: [
          { emoji: "heart", count: 1, mine: true, names: ["박지훈"] },
        ],
      }),
      { read: true },
    );
    const article = screen.getByRole("article");
    const content = element(article, "[data-message-content]");
    expect(content).toHaveClass("items-end");
    const cards = element(article, "[data-message-attachments]");
    const reactions = within(article).getByRole("group", {
      name: "메시지 반응",
    });
    const receipt = element(article, "[data-chat-read-receipt]");
    for (const child of [cards, reactions, receipt])
      expect(content).toContainElement(child);
    expect(bubble(article)).not.toContainElement(cards);
    expect(bubble(article)).not.toContainElement(reactions);
    expect(receipt).toHaveClass("text-right");
    expect(receipt).toHaveTextContent("읽음");
    expect(
      reactions.compareDocumentPosition(receipt) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("replaces the bubble and time with the existing neutral editor", () => {
    drawRow(message(1, { authorId: me, authorName: "박지훈" }), {
      editor: <textarea aria-label="메시지 수정" defaultValue="수정 중" />,
    });
    const article = screen.getByRole("article");
    expect(article.querySelector("[data-message-bubble]")).toBeNull();
    expect(article.querySelector("[data-message-time]")).toBeNull();
    expect(article.querySelector("time")).toBeNull();
    const editor = within(article).getByRole("textbox", {
      name: "메시지 수정",
    });
    expect(editor).toHaveValue("수정 중");
    expect(element(article, "[data-message-content]")).toContainElement(editor);
    expect(editor.closest(".bg-card")).not.toBeNull();
    expect(within(article).queryByText("본문 1")).toBeNull();
  });

  it.each([false, true])(
    "highlights only the bubble for a direct/everyone mention (%s)",
    (everyone) => {
      drawRow(
        message(1, {
          mentions: everyone ? [] : [{ userId: me, name: "박지훈" }],
          mentionsEveryone: everyone,
        }),
        { highlighted: true },
      );
      const article = screen.getByRole("article");
      expect(article).toHaveAttribute("data-mentioned", "true");
      expect(article).toHaveAttribute("data-highlighted", "true");
      expect(article).not.toHaveClass("bg-status-pending", "bg-accent");
      expect(bubble(article)).toHaveClass(
        "bg-status-pending",
        "text-status-pending-foreground",
        "border-status-pending-border",
        "ring-2",
        "ring-ring/40",
      );
    },
  );

  it("keeps pending and failed metadata visible even when the minute's time is hidden", async () => {
    const retry = vi.fn();
    const remove = vi.fn();
    await draw(
      [
        message(1, { authorId: me, authorName: "박지훈", delivery: "pending" }),
        message(2, { authorId: me, authorName: "박지훈", delivery: "pending" }),
        message(3, { authorId: me, authorName: "박지훈", delivery: "failed" }),
        message(4, { authorId: me, authorName: "박지훈", delivery: "failed" }),
      ],
      { onRetry: retry, onRemove: remove },
    );
    expect(shownTimes()).toEqual(["false", "true", "false", "true"]);
    for (const id of ["message-1", "message-2"]) {
      const article = row(id);
      expect(article).toHaveAttribute("data-delivery", "pending");
      expect(article).toHaveAttribute("data-bubble-state", "pending");
      expect(article).not.toHaveClass("opacity-50");
      expect(element(article, "[data-message-time]")).toHaveTextContent(
        "보내는 중",
      );
    }
    const failed = row("message-3");
    expect(failed).toHaveAttribute("data-bubble-state", "failed");
    expect(bubble(failed)).toHaveClass(
      "bg-chat-pending",
      "text-chat-pending-foreground",
    );
    expect(within(failed).getByText("보내지 못했어요")).toHaveClass(
      "text-destructive",
    );
    fireEvent.click(
      within(failed).getByRole("button", { name: "다시 보내기" }),
    );
    fireEvent.click(within(failed).getByRole("button", { name: "지우기" }));
    expect(retry).toHaveBeenCalledWith(
      expect.objectContaining({ id: "message-3" }),
    );
    expect(remove).toHaveBeenCalledWith(
      expect.objectContaining({ id: "message-3" }),
    );
  });

  it("uses a same-side dashed deleted placeholder without the body, files or reactions", () => {
    drawRow(
      message(1, {
        authorId: me,
        authorName: "박지훈",
        body: "유출되면 안 되는 본문",
        deletedAt: now,
        attachments: [attachment],
        reactions: [
          { emoji: "heart", count: 1, mine: true, names: ["박지훈"] },
        ],
      }),
    );
    const article = screen.getByRole("article");
    expect(article).toHaveAttribute("data-side", "mine");
    expect(article).toHaveAttribute("data-bubble-state", "deleted");
    expect(bubble(article)).toHaveClass(
      "border",
      "border-dashed",
      "bg-transparent",
      "text-muted-foreground",
    );
    expect(screen.getByText("삭제된 메시지예요")).toHaveClass("italic");
    expect(screen.queryByText("유출되면 안 되는 본문")).toBeNull();
    expect(article.querySelector("[data-message-attachments]")).toBeNull();
    expect(
      within(article).queryByRole("group", { name: "메시지 반응" }),
    ).toBeNull();
  });

  it("uses a card-level highlight for attachment-only originals", () => {
    drawRow(message(1, { body: "", attachments: [attachment] }), {
      highlighted: true,
    });
    const article = screen.getByRole("article");
    const cards = element(article, "[data-message-attachments]");
    expect(article).toHaveAttribute("data-highlighted", "true");
    expect(article).not.toHaveClass("bg-accent");
    const highlightedCards = element(cards, "[data-message-attachment-cards]");
    expect(highlightedCards).toHaveClass("ring-2", "ring-ring/40");
    expect(highlightedCards).toContainElement(
      screen.getByText(attachment.name),
    );
    expect(article.querySelector("[data-message-bubble]")).toBeNull();
  });

  it("uses mine-toned links, mentions and code without altering their safe content", () => {
    drawRow(
      message(1, {
        authorId: me,
        authorName: "박지훈",
        body: `<@${other}> https://example.com \`코드\`\n\`\`\`\n긴 코드\n\`\`\``,
        mentions: [{ userId: other, name: "이서연" }],
      }),
    );
    const article = screen.getByRole("article");
    expect(
      within(article).getByRole("link", { name: "https://example.com" }),
    ).toHaveClass("underline", "text-current");
    expect(within(article).getByText("@이서연")).toHaveClass(
      "bg-chat-mine-foreground/20",
    );
    expect(within(article).getByText("코드")).toHaveClass(
      "bg-chat-mine-foreground/20",
    );
    const codeBlock = element(article, "pre");
    expect(codeBlock).toHaveClass(
      "overflow-x-auto",
      "bg-chat-mine-foreground/20",
    );
    expect(codeBlock).toHaveTextContent("긴 코드");
  });

  it("centers a folded blocked row without a bubble and preserves its expand action", () => {
    const expand = vi.fn();
    drawRow(message(1), { foldedCount: 2, onExpand: expand });
    const article = screen.getByRole("article");
    expect(article.querySelector("[data-message-bubble]")).toBeNull();
    const expandButton = screen.getByRole("button", {
      name: "차단한 사용자의 메시지 2개 · 보기",
    });
    expect(expandButton.parentElement).toBe(article);
    expect(expandButton).toHaveClass("mx-auto");
    fireEvent.click(expandButton);
    expect(expand).toHaveBeenCalledOnce();
  });
});
