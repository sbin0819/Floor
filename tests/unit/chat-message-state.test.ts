import { describe, expect, it } from "vitest";
import {
  chatDate,
  formatChatDate,
  formatChatTime,
} from "@/lib/time/chat-format";
import {
  isMessageContinuation,
  mergeChatMessages,
  messageKey,
  type DisplayMessage,
} from "@/features/chat/components/message-state";

const now = "2026-10-08T03:00:00Z";
function message(overrides: Partial<DisplayMessage> = {}): DisplayMessage {
  return {
    id: "message",
    seq: 1,
    authorId: "me",
    authorName: "박지훈",
    kind: "text",
    body: "안녕하세요",
    clientId: "client",
    createdAt: "2026-10-08T00:12:00Z",
    ...overrides,
  };
}

describe("chat date presentation", () => {
  it("uses the server instant and explicit Seoul dates at the UTC date boundary", () => {
    expect(chatDate("2026-10-07T15:01:00Z")).toBe("2026-10-08");
    expect(formatChatDate("2026-10-07T15:01:00Z", now)).toBe("오늘");
    expect(formatChatDate("2026-10-07T14:59:00Z", now)).toBe("어제");
    expect(formatChatDate("2026-10-06T03:00:00Z", now)).toBe("10월 6일 화요일");
    expect(formatChatTime("2026-10-08T00:12:00Z")).toBe("오전 9:12");
    expect(formatChatTime("2026-10-08T06:12:00Z")).toBe("오후 3:12");
  });
  it("supports another explicit timezone independently of the process timezone", () => {
    expect(
      formatChatDate("2026-10-08T00:12:00Z", now, "America/Los_Angeles"),
    ).toBe("오늘");
    expect(formatChatTime("2026-10-08T00:12:00Z", "America/Los_Angeles")).toBe(
      "오후 5:12",
    );
  });
});

describe("message identity, order and grouping", () => {
  it("merges action and realtime acknowledgments without replacing the optimistic key", () => {
    const pending = message({ id: "client", seq: 0, delivery: "pending" });
    const saved = message();
    const result = mergeChatMessages([pending], [saved, saved], "me");
    expect(result).toEqual([saved]);
    expect(messageKey(result[0]!, "me")).toBe(messageKey(pending, "me"));
  });
  it("does not confuse a different author reusing a client identifier", () => {
    const pending = message({ id: "client", seq: 0, delivery: "pending" });
    const other = message({ id: "other", authorId: "other", seq: 1 });
    expect(mergeChatMessages([pending], [other], "me")).toEqual([
      other,
      pending,
    ]);
    expect(messageKey(other, "me")).toBe("other");
  });
  it("sorts out-of-order confirmed messages and keeps unsent entries at the end", () => {
    const first = message({ id: "first", seq: 1, clientId: null });
    const third = message({ id: "third", seq: 3, clientId: null });
    const second = message({ id: "second", seq: 2, clientId: null });
    const pending = message({ id: "pending", delivery: "pending", seq: 0 });
    expect(
      mergeChatMessages([first, pending], [third, second, third], "me"),
    ).toEqual([first, second, third, pending]);
  });
  it("merges refreshed server messages while preserving local pending and previous history", () => {
    const first = message({ id: "old", clientId: null });
    const pending = message({ id: "pending", seq: 0, delivery: "pending" });
    const fresh = message({ id: "new", seq: 2, clientId: null });
    expect(mergeChatMessages([first, pending], [fresh], "me")).toEqual([
      first,
      fresh,
      pending,
    ]);
  });
  it("groups only the same author on the same date within five minutes", () => {
    const previous = message();
    expect(
      isMessageContinuation(
        previous,
        message({ createdAt: "2026-10-08T00:17:00Z" }),
      ),
    ).toBe(true);
    expect(
      isMessageContinuation(
        previous,
        message({ createdAt: "2026-10-08T00:17:01Z" }),
      ),
    ).toBe(false);
    expect(
      isMessageContinuation(previous, message({ authorId: "other" })),
    ).toBe(false);
    expect(
      isMessageContinuation(
        previous,
        message({ kind: "system", authorId: null }),
      ),
    ).toBe(false);
    expect(
      isMessageContinuation(
        message({ createdAt: "2026-10-07T14:59:00Z" }),
        message({ createdAt: "2026-10-07T15:01:00Z" }),
      ),
    ).toBe(false);
  });
});
