import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MessageList } from "@/features/chat/components/message-list";
import { MessageComposer } from "@/features/chat/components/message-composer";
import { Profiler } from "react";
import type { ChatMessage } from "@/features/chat/types";
import { emptyMessageDetails } from "@/features/chat/types";
import { installChatViewport } from "../helpers/chat-viewport";

function message(
  seq: number,
  overrides: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    ...emptyMessageDetails(),
    id: `m-${seq}`,
    seq,
    kind: "text",
    body: `메시지 ${seq}`,
    authorId: "other",
    authorName: "이서연",
    clientId: null,
    createdAt: "2026-10-08T03:00:00Z",
    ...overrides,
  };
}
const range = (start: number, count: number) =>
  Array.from({ length: count }, (_, index) => message(start + index));
const props = {
  channelName: "일반",
  now: "2026-10-08T04:00:00Z",
  userId: "me",
  onRetry: vi.fn(),
  onRemove: vi.fn(),
};
let restore: () => void;
beforeEach(() => {
  restore = installChatViewport();
});
afterEach(() => restore());

describe("virtual message list", () => {
  it("keeps 10,000 measured rows bounded to the viewport plus overscan", async () => {
    const { container } = render(
      <MessageList {...props} messages={range(1, 10_000)} />,
    );
    const region = screen.getByRole("region", { name: "일반 메시지" });
    await waitFor(() => expect(region.scrollTop).toBeGreaterThan(700_000));
    expect(container.querySelectorAll("[data-message-id]").length).toBeLessThan(
      25,
    );
    fireEvent.scroll(region, { target: { scrollTop: 400_000 } });
    expect(container.querySelectorAll("[data-message-id]").length).toBeLessThan(
      25,
    );
    expect(
      container.querySelectorAll("[data-message-id]").length,
    ).toBeGreaterThan(5);
    expect(region).toHaveAttribute("aria-live", "off");
    expect(screen.queryByRole("log")).not.toBeInTheDocument();
  });
  it("places the first unread row a third down and retains the divider after read metadata changes", async () => {
    const messages = range(1, 50);
    const result = render(
      <MessageList {...props} messages={messages} firstUnreadSeq={30} />,
    );
    const region = screen.getByRole("region", { name: "일반 메시지" });
    await waitFor(() => expect(region.scrollTop).toBe(44 + 29 * 80 - 200));
    expect(
      result.container.querySelector(
        '[data-message-id="m-30"] [data-unread-divider]',
      ),
    ).toHaveTextContent("새 메시지");
    result.rerender(
      <MessageList {...props} messages={messages} firstUnreadSeq={null} />,
    );
    expect(
      result.container.querySelector(
        '[data-message-id="m-30"] [data-unread-divider]',
      ),
    ).not.toBeNull();
  });
  it("loads toward an unread cursor outside the initial 50, but stops at 500", async () => {
    const older = vi.fn(async () => {});
    const result = render(
      <MessageList
        {...props}
        messages={range(951, 50)}
        firstUnreadSeq={600}
        hasMore
        onLoadOlder={older}
      />,
    );
    await waitFor(() => expect(older).toHaveBeenCalledOnce());
    result.rerender(
      <MessageList
        {...props}
        messages={range(551, 450)}
        firstUnreadSeq={600}
        hasMore
        onLoadOlder={older}
      />,
    );
    await waitFor(() =>
      expect(
        result.container.querySelector(
          '[data-message-id="m-600"] [data-unread-divider]',
        ),
      ).not.toBeNull(),
    );
    result.unmount();
    older.mockClear();
    const capped = render(
      <MessageList
        {...props}
        messages={range(501, 500)}
        firstUnreadSeq={5}
        hasMore
        onLoadOlder={older}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole("region").scrollTop).toBeGreaterThan(30_000),
    );
    expect(older).not.toHaveBeenCalled();
    expect(capped.container.querySelector("[data-unread-divider]")).toBeNull();
  });
  it("keeps the visible keyed anchor in place when 50 older rows are prepended", async () => {
    const older = vi.fn(async () => {});
    const result = render(
      <MessageList
        {...props}
        messages={range(51, 50)}
        hasMore
        onLoadOlder={older}
      />,
    );
    const region = screen.getByRole("region");
    await waitFor(() => expect(region.scrollTop).toBeGreaterThan(3_000));
    // 최초 위치 보정 프레임이 끝난 뒤의 사용자 스크롤을 재현한다.
    await act(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
    fireEvent.scroll(region, { target: { scrollTop: 164 } });
    const anchor = result.container.querySelector<HTMLElement>(
      '[data-message-id="m-52"]',
    )!;
    const top =
      Number.parseFloat(anchor.style.transform.slice(11)) - region.scrollTop;
    expect(older).toHaveBeenCalledOnce();
    result.rerender(<MessageList {...props} messages={range(1, 100)} />);
    await waitFor(() => expect(region.scrollTop).toBe(4_164));
    await waitFor(() => {
      const next = result.container.querySelector<HTMLElement>(
        '[data-message-id="m-52"]',
      )!;
      expect(
        Number.parseFloat(next.style.transform.slice(11)) - region.scrollTop,
      ).toBe(top);
    });
    const next = result.container.querySelector<HTMLElement>(
      '[data-message-id="m-52"]',
    )!;
    expect(next).toBe(anchor);
    fireEvent.scroll(region, { target: { scrollTop: 0 } });
    expect(screen.getByText("#일반의 처음이에요")).toBeVisible();
  });
  it("reports only actually visible last rows, not virtual overscan, and clears on unmount", async () => {
    const viewport = vi.fn();
    const result = render(
      <MessageList {...props} messages={range(1, 30)} onViewport={viewport} />,
    );
    const region = screen.getByRole("region");
    await waitFor(() => expect(viewport).toHaveBeenLastCalledWith(true, 30));
    fireEvent.scroll(region, { target: { scrollTop: 1_200 } });
    expect(viewport).toHaveBeenLastCalledWith(false, null);
    result.unmount();
    expect(viewport).toHaveBeenLastCalledWith(false, null);
  });
  it("announces only explicit direct realtime additions, with Unicode-safe clipping and batches", async () => {
    const initial = range(1, 5);
    const result = render(<MessageList {...props} messages={initial} />);
    const status = screen.getByRole("status");
    expect(status).toBeEmptyDOMElement();
    result.rerender(<MessageList {...props} messages={range(1, 10)} />);
    expect(status).toBeEmptyDOMElement();
    result.rerender(
      <MessageList
        {...props}
        messages={range(1, 10)}
        liveMessages={[message(11, { authorId: "me" })]}
      />,
    );
    expect(status).toBeEmptyDOMElement();
    const incoming = message(12, { body: "가😀".repeat(100) });
    result.rerender(
      <MessageList
        {...props}
        messages={range(1, 10)}
        liveMessages={[incoming]}
      />,
    );
    expect(status).toHaveTextContent(`이서연: ${"가😀".repeat(50)}`);
    expect(Array.from(status.textContent!.split(": ")[1]!)).toHaveLength(100);
    result.rerender(
      <MessageList
        {...props}
        messages={range(1, 10)}
        liveMessages={[incoming, message(13), message(14)]}
      />,
    );
    expect(status).toHaveTextContent("새 메시지 2개");
    await act(async () => {});
  });
  it("does not render the message list again while typing a draft", async () => {
    const rendered = vi.fn();
    render(
      <>
        <Profiler id="messages" onRender={rendered}>
          <MessageList {...props} messages={range(1, 100)} />
        </Profiler>
        <MessageComposer channelName="일반" onSend={vi.fn()} />
      </>,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    rendered.mockClear();
    const input = screen.getByRole("textbox", { name: "메시지" });
    for (const value of ["안", "안녕", "안녕하세요"])
      fireEvent.change(input, { target: { value } });
    expect(input).toHaveValue("안녕하세요");
    expect(rendered).not.toHaveBeenCalled();
  });
});
