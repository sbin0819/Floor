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
import { Activity, useState } from "react";
import { MessageComposer } from "@/features/chat/components/message-composer";
import { MessageEditor } from "@/features/chat/components/message-editor";
import { MessageList } from "@/features/chat/components/message-list";
import { emptyMessageDetails, type ChatMessage } from "@/features/chat/types";
import type { MessageActions } from "@/features/chat/components/message-row";
import { installChatViewport } from "../helpers/chat-viewport";

const lee = "00000000-0000-4000-8000-000000000001";
const park = "00000000-0000-4000-8000-000000000002";
const members = [
  { userId: lee, name: "이서연" },
  { userId: park, name: "박지훈" },
];
const names = new Map(members.map(({ userId, name }) => [userId, name]));
const now = "2026-10-08T03:00:00Z";
let restore: () => void;
beforeEach(() => {
  restore = installChatViewport();
});
afterEach(() => restore());

describe("reply, editing, and selected mention composition", () => {
  it("chooses a mention with arrows and Tab while preserving combobox focus and sends its token", async () => {
    const send = vi.fn();
    render(
      <MessageComposer channelName="일반" onSend={send} members={members} />,
    );
    const input = screen.getByRole("combobox", { name: "메시지" });
    input.focus();
    fireEvent.change(input, { target: { value: "@" } });
    expect(screen.getByRole("listbox", { name: "멘션할 사람" })).toBeVisible();
    expect(input).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: "@박지훈" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.keyDown(input, { key: "Tab" });
    await waitFor(() => expect(input).toHaveValue("@박지훈 "));
    expect(input).toHaveFocus();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(send).toHaveBeenCalledWith(`<@${park}>`);
  });

  it("does not select a mention while composing Korean and Escape dismisses suggestions", () => {
    render(
      <MessageComposer channelName="일반" onSend={vi.fn()} members={members} />,
    );
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "@이" } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(input).toHaveValue("@이");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("makes changed selected names plain text and offers everyone only to administrators", () => {
    const send = vi.fn();
    render(
      <MessageComposer
        channelName="일반"
        onSend={send}
        members={members}
        allowEveryone
      />,
    );
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "@이" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input).toHaveValue("@이서연 ");
    fireEvent.change(input, { target: { value: "@이서영 " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(send).toHaveBeenCalledWith("@이서영");
    fireEvent.change(input, { target: { value: "@" } });
    expect(screen.getAllByRole("option").at(-1)).toHaveTextContent("@모두");
  });

  it("shows a reply preview and forwards the same reply when sending", () => {
    const reply = {
      id: "source",
      authorName: "이서연",
      excerpt: "원문 한 줄",
      deleted: false,
    };
    const send = vi.fn();
    const clear = vi.fn();
    render(
      <MessageComposer
        channelName="일반"
        onSend={send}
        reply={reply}
        onClearReply={clear}
      />,
    );
    expect(screen.getByText("이서연에게 답장")).toBeVisible();
    expect(screen.getByText("원문 한 줄")).toBeVisible();
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "답변" },
    });
    fireEvent.click(screen.getByRole("button", { name: "보내기" }));
    expect(send).toHaveBeenCalledWith("답변", reply);
    expect(clear).toHaveBeenCalledOnce();
  });

  it("opens the last edit only from an empty composer", () => {
    const edit = vi.fn();
    render(
      <MessageComposer channelName="일반" onSend={vi.fn()} onEditLast={edit} />,
    );
    const input = screen.getByRole("combobox");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(edit).toHaveBeenCalledOnce();
    fireEvent.change(input, { target: { value: "안녕" } });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(edit).toHaveBeenCalledOnce();
  });

  it("restores selected names for edit, preserves tokens on Enter, and supports Escape", async () => {
    const save = vi.fn(async () => true);
    const cancel = vi.fn();
    render(
      <MessageEditor
        messageId="message"
        body={`**<@${lee}>** <@everyone>`}
        names={names}
        members={members}
        allowEveryone
        onSave={save}
        onCancel={cancel}
      />,
    );
    const input = screen.getByRole("combobox", { name: "메시지 수정" });
    expect(input).toHaveValue("**@이서연** @모두");
    expect(input).toHaveFocus();
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith("message", `**<@${lee}>** <@everyone>`),
    );
    await waitFor(() => expect(cancel).toHaveBeenCalledOnce());
    fireEvent.keyDown(input, { key: "Escape" });
    expect(cancel).toHaveBeenCalledTimes(2);
  });

  it("keeps failed edit input and prevents duplicate submission", async () => {
    let finish!: (value: boolean) => void;
    const save = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    const cancel = vi.fn();
    render(
      <MessageEditor
        messageId="message"
        body="원문"
        names={names}
        members={members}
        allowEveryone={false}
        onSave={save}
        onCancel={cancel}
      />,
    );
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "수정한 내용" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(save).toHaveBeenCalledOnce();
    expect(input).toBeDisabled();
    await act(async () => finish(false));
    expect(cancel).not.toHaveBeenCalled();
    expect(input).toHaveValue("수정한 내용");
    expect(input).toBeEnabled();
  });
  it("does not strand a pending editor when Activity is hidden before its response", async () => {
    let finish!: (value: boolean) => void;
    const cancel = vi.fn();
    const save = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    const tree = (hidden: boolean) => (
      <Activity mode={hidden ? "hidden" : "visible"}>
        <MessageEditor
          messageId="message"
          body="원문"
          names={names}
          members={members}
          allowEveryone={false}
          onSave={save}
          onCancel={cancel}
        />
      </Activity>
    );
    const result = render(tree(false));
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    result.rerender(tree(true));
    await act(async () => finish(true));
    expect(cancel).not.toHaveBeenCalled();
    result.rerender(tree(false));
    expect(screen.getByRole("combobox")).toBeEnabled();
    expect(screen.getByRole("combobox")).toHaveValue("원문");
  });
});

function message(seq: number, values: Partial<ChatMessage> = {}): ChatMessage {
  return {
    ...emptyMessageDetails(),
    id: `m-${seq}`,
    seq,
    body: `메시지 ${seq}`,
    authorId: lee,
    authorName: "이서연",
    kind: "text",
    createdAt: now,
    clientId: null,
    ...values,
  };
}
const actions: MessageActions = {
  userId: park,
  canWrite: true,
  canReact: true,
  admin: true,
  names,
  react: async () => true,
  onDelete: vi.fn(),
};
describe("reply source navigation", () => {
  it("fetches older pages for a missing source then focuses and highlights the article", async () => {
    const load = vi.fn();
    function View() {
      const [rows, setRows] = useState([
        ...Array.from({ length: 49 }, (_, index) => message(index + 60)),
        message(109, {
          replyTo: {
            id: "m-1",
            authorName: "이서연",
            excerpt: "메시지 1",
            deleted: false,
          },
        }),
      ]);
      return (
        <MessageList
          messages={rows}
          channelName="일반"
          now={now}
          userId={park}
          actions={actions}
          hasMore={rows.length === 50}
          onLoadOlder={async (limit) => {
            load(limit);
            setRows([message(1), ...rows]);
          }}
          onRetry={vi.fn()}
          onRemove={vi.fn()}
        />
      );
    }
    const { container } = render(<View />);
    await userEvent.click(
      await screen.findByRole("button", { name: /님의 원문: 메시지 1/ }),
    );
    await waitFor(() =>
      expect(
        container.querySelector('[data-message-id="m-1"] article'),
      ).toHaveAttribute("data-highlighted", "true"),
    );
    expect(load).toHaveBeenCalledWith(500);
    expect(
      container.querySelector('[data-message-id="m-1"] article'),
    ).toHaveFocus();
  });

  it("does not load beyond 500 messages and presents a safe message", async () => {
    const load = vi.fn();
    const rows = Array.from({ length: 500 }, (_, index) =>
      message(index + 100),
    );
    rows[499]!.replyTo = {
      id: "m-1",
      authorName: "이서연",
      excerpt: "아주 오래된 원문",
      deleted: false,
    };
    render(
      <MessageList
        messages={rows}
        channelName="일반"
        now={now}
        userId={park}
        actions={actions}
        hasMore
        onLoadOlder={load}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    await userEvent.click(
      await screen.findByRole("button", { name: /아주 오래된 원문/ }),
    );
    expect(await screen.findByText("원문이 너무 멀리 있어요")).toBeVisible();
    expect(load).not.toHaveBeenCalled();
  });

  it("supports a mention toast URL target with the same source navigation", async () => {
    const { container } = render(
      <MessageList
        messages={[message(1), message(2)]}
        channelName="일반"
        now={now}
        userId={park}
        actions={actions}
        jumpToId="m-1"
        onRetry={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(
        container.querySelector('[data-message-id="m-1"] article'),
      ).toHaveFocus(),
    );
    expect(
      within(screen.getAllByRole("article")[0]!).getByText("메시지 1"),
    ).toBeVisible();
  });
});
