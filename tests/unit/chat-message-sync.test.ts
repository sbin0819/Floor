import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyMessageEvent,
  createMessageSync,
  invalidateMessage,
} from "@/features/chat/message-sync";
import { requestMessagePage } from "@/features/chat/message-requests";
import {
  mergeChatMessages,
  roomMessagesKey,
  type DisplayMessage,
} from "@/features/chat/components/message-state";
import {
  emptyMessageDetails,
  type RoomMessagesPage,
} from "@/features/chat/types";
import type { RealtimeEvent } from "@/lib/realtime/types";

vi.mock("@/features/chat/message-requests", () => ({
  requestMessagePage: vi.fn(),
}));

const roomId = "room-a";
const userId = "me";
const mentionedId = "20000000-0000-4000-8000-000000000001";
const editedAt = "2026-10-08T00:01:00.000Z";
function message(
  seq: number,
  extra: Partial<DisplayMessage> = {},
): DisplayMessage {
  return {
    ...emptyMessageDetails(),
    id: `message-${seq}`,
    seq,
    authorId: "other",
    authorName: "이서연",
    kind: "text",
    body: `${seq}번째`,
    clientId: null,
    createdAt: "2026-10-08T00:00:00.000Z",
    ...extra,
  };
}
function page(messages: DisplayMessage[]): RoomMessagesPage {
  return {
    messages,
    hasMore: false,
    lastSeq: 999,
    lastReadSeq: 9,
    firstUnreadSeq: 10,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function updated(
  extra: Partial<Extract<RealtimeEvent, { type: "message.updated" }>> = {},
): Extract<RealtimeEvent, { type: "message.updated" }> {
  return {
    type: "message.updated",
    roomId,
    id: "message-1",
    seq: 1,
    body: `새 본문 <@${mentionedId}>`,
    mentions: [{ userId: mentionedId, name: "김민지" }],
    mentionsEveryone: false,
    editedAt,
    ...extra,
  };
}
const deleted: RealtimeEvent = {
  type: "message.deleted",
  roomId,
  id: "message-1",
  seq: 1,
};
const reply = () =>
  message(51, {
    replyTo: {
      id: "message-1",
      authorName: "이서연",
      excerpt: "원문",
      deleted: false,
    },
  });
const clients: QueryClient[] = [];
const synchronizers: ReturnType<typeof createMessageSync>[] = [];
function setup(messages = [message(1)]) {
  const client = new QueryClient();
  clients.push(client);
  client.setQueryData(roomMessagesKey(roomId), messages);
  const sync = createMessageSync(client, roomId, userId);
  synchronizers.push(sync);
  sync.start();
  return {
    client,
    sync,
    read: () => client.getQueryData<DisplayMessage[]>(roomMessagesKey(roomId))!,
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(requestMessagePage).mockReset().mockResolvedValue(page([]));
});
afterEach(() => {
  synchronizers.splice(0).forEach((sync) => sync.stop());
  clients.splice(0).forEach((client) => client.clear());
  vi.useRealTimers();
});

describe("loaded message page reconciliation", () => {
  it("coalesces changes in the same fixed 50-sequence page for 250ms", async () => {
    const { sync } = setup([message(1), message(50), message(51)]);
    sync.changed(1);
    sync.changed(50);
    await vi.advanceTimersByTimeAsync(249);
    expect(requestMessagePage).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(requestMessagePage).toHaveBeenCalledTimes(1);
    expect(requestMessagePage).toHaveBeenLastCalledWith(
      expect.any(QueryClient),
      roomId,
      { before: 51 },
      { background: true, signal: expect.any(AbortSignal) },
    );
    sync.changed(51);
    await vi.advanceTimersByTimeAsync(250);
    expect(requestMessagePage).toHaveBeenLastCalledWith(
      expect.any(QueryClient),
      roomId,
      { before: 101 },
      expect.anything(),
    );
  });

  it("does not read unknown pages, unsent rows or invalid sequence numbers", async () => {
    const { sync } = setup([message(1), message(101, { delivery: "pending" })]);
    for (const seq of [0, -1, 1.5, Number.NaN, 51, 101]) sync.changed(seq);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(requestMessagePage).not.toHaveBeenCalled();
  });

  it("updates only already loaded rows and preserves pending, failed and optimistic reaction state", async () => {
    const pending = message(0, {
      id: "pending",
      authorId: userId,
      clientId: "pending",
      delivery: "pending",
    });
    const failed = message(0, {
      id: "failed",
      authorId: userId,
      clientId: "failed",
      delivery: "failed",
      errorCode: "INTERNAL",
    });
    const reactionIntents = { heart: { token: "intent", on: true } } as const;
    const { client, sync, read } = setup([
      message(1, { reactionIntents }),
      message(51),
      pending,
      failed,
    ]);
    const fresh = message(1, {
      body: "서버 본문",
      reactions: [{ emoji: "heart", count: 3, mine: false, names: ["김민지"] }],
    });
    client.setQueryData(["read-boundary", roomId], {
      lastReadSeq: 0,
      firstUnreadSeq: 1,
    });
    vi.mocked(requestMessagePage).mockResolvedValue(
      page([fresh, message(2), message(51, { body: "잘못된 구간" })]),
    );
    sync.changed(1);
    await vi.advanceTimersByTimeAsync(250);
    expect(read()).toEqual([
      { ...fresh, reactionIntents },
      message(51),
      pending,
      failed,
    ]);
    expect(client.getQueryData(["read-boundary", roomId])).toEqual({
      lastReadSeq: 0,
      firstUnreadSeq: 1,
    });
  });

  it("discards an in-flight page invalidated by a later event and retries its newer epoch", async () => {
    const first = deferred<RoomMessagesPage>();
    const { client, sync, read } = setup();
    vi.mocked(requestMessagePage)
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(
        page([message(1, { body: "최신 서버", editedAt })]),
      );
    sync.changed(1);
    await vi.advanceTimersByTimeAsync(250);
    client.setQueryData(
      roomMessagesKey(roomId),
      applyMessageEvent(read(), updated(), new Map()),
    );
    sync.changed(1);
    first.resolve(page([message(1, { body: "이전 응답" })]));
    await vi.advanceTimersByTimeAsync(0);
    expect(read()[0]?.body).toContain("새 본문");
    await vi.advanceTimersByTimeAsync(1_999);
    expect(requestMessagePage).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(requestMessagePage).toHaveBeenCalledTimes(2);
    expect(read()[0]?.body).toBe("최신 서버");
  });

  it("invalidates loaded replies when their original message is outside the loaded range", async () => {
    const old = deferred<RoomMessagesPage>();
    const { client, sync, read } = setup([reply()]);
    vi.mocked(requestMessagePage).mockReturnValueOnce(old.promise);
    sync.revalidate();
    client.setQueryData(
      roomMessagesKey(roomId),
      applyMessageEvent(read(), updated(), new Map()),
    );
    sync.changed(1, "message-1");
    old.resolve(page([reply()]));
    await vi.advanceTimersByTimeAsync(0);
    expect(read()[0]?.replyTo?.excerpt).toBe("새 본문 @김민지");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(requestMessagePage).toHaveBeenCalledTimes(2);
    expect(
      vi.mocked(requestMessagePage).mock.calls.map((call) => call[2]),
    ).toEqual([{ before: 101 }, { before: 101 }]);
  });

  it("stops requests and ignores old lifetime responses even after a restart and newer response", async () => {
    const old = deferred<RoomMessagesPage>();
    const fresh = deferred<RoomMessagesPage>();
    const { sync, read } = setup();
    vi.mocked(requestMessagePage)
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(fresh.promise);
    sync.revalidate();
    const signal = vi.mocked(requestMessagePage).mock.calls[0]![3]?.signal;
    sync.stop();
    expect(signal?.aborted).toBe(true);
    sync.start();
    sync.revalidate();
    fresh.resolve(page([message(1, { body: "복귀 후" })]));
    await vi.advanceTimersByTimeAsync(0);
    old.resolve(page([message(1, { body: "이탈 전" })]));
    await vi.advanceTimersByTimeAsync(0);
    expect(read()[0]?.body).toBe("복귀 후");
    sync.stop();
    sync.changed(1);
    sync.revalidate();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(requestMessagePage).toHaveBeenCalledTimes(2);
  });

  it("reconnects in visible, latest, remaining order even if another page had a queued change", async () => {
    const { sync } = setup([
      message(1),
      message(51),
      message(101),
      message(151),
    ]);
    sync.changed(1);
    sync.visible(51);
    sync.revalidate();
    expect(
      vi.mocked(requestMessagePage).mock.calls.map((call) => call[2]),
    ).toEqual([
      { before: 101 },
      { before: 201 },
      { before: 151 },
      { before: 51 },
    ]);
    await vi.advanceTimersByTimeAsync(250);
    expect(requestMessagePage).toHaveBeenCalledTimes(4);
  });

  it("leaves a failed page queued and retries after two seconds rather than looping", async () => {
    const { sync, read } = setup();
    vi.mocked(requestMessagePage)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(page([message(1, { body: "다시 연결됨" })]));
    sync.revalidate();
    await vi.advanceTimersByTimeAsync(0);
    expect(read()[0]?.body).toBe("1번째");
    await vi.advanceTimersByTimeAsync(1_999);
    expect(requestMessagePage).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(requestMessagePage).toHaveBeenCalledTimes(2);
    expect(read()[0]?.body).toBe("다시 연결됨");
  });

  it("routes invalidations only to active synchronizers of the same QueryClient and room", async () => {
    const first = setup();
    const second = setup();
    invalidateMessage(first.client, "other-room", 1);
    invalidateMessage(first.client, roomId, 1);
    await vi.advanceTimersByTimeAsync(250);
    expect(requestMessagePage).toHaveBeenCalledTimes(1);
    expect(requestMessagePage).toHaveBeenCalledWith(
      first.client,
      roomId,
      expect.anything(),
      expect.anything(),
    );
    first.sync.stop();
    invalidateMessage(first.client, roomId, 1);
    invalidateMessage(second.client, roomId, 1);
    await vi.advanceTimersByTimeAsync(250);
    expect(requestMessagePage).toHaveBeenCalledTimes(2);
    expect(requestMessagePage).toHaveBeenLastCalledWith(
      second.client,
      roomId,
      expect.anything(),
      expect.anything(),
    );
  });

  it("preserves unseen changes across stop/start and projects hidden cache arrivals safely", () => {
    const { client, sync, read } = setup([message(2)]);
    sync.receiveChange(deleted, new Map());
    sync.stop();
    client.setQueryData(roomMessagesKey(roomId), [message(1), message(2)]);
    expect(sync.project(read())[0]).toMatchObject({
      body: "",
      deletedAt: expect.any(String),
    });
    sync.start();
    expect(read()[0]).toMatchObject({
      body: "",
      deletedAt: expect.any(String),
    });
    sync.receiveChange(updated(), new Map());
    expect(read()[0]?.body).toBe("");
  });

  it("isolates unseen changes by room and drops the pending edit after a row is reconciled", () => {
    const { client, sync, read } = setup([message(2)]);
    sync.receiveChange(updated(), new Map());
    const otherRows = [message(1, { body: "다른 방" })];
    client.setQueryData(roomMessagesKey("room-b"), otherRows);
    expect(client.getQueryData(roomMessagesKey("room-b"))).toEqual(otherRows);
    client.setQueryData(roomMessagesKey(roomId), [message(1), message(2)]);
    expect(read()[0]?.body).toContain("새 본문");
    client.setQueryData(roomMessagesKey(roomId), [
      message(1, {
        body: "최신 서버 응답",
        editedAt: "2026-10-08T00:03:00.000Z",
      }),
      message(2),
    ]);
    expect(read()[0]?.body).toBe("최신 서버 응답");
    expect(sync.project(read())[0]?.body).toBe("최신 서버 응답");
  });
});

describe("message edits, deletion and reply snapshots", () => {
  it("updates existing body and reply excerpts with resolved names, not unknown source rows", () => {
    const rows = applyMessageEvent([message(1), reply()], updated(), new Map());
    expect(rows[0]).toMatchObject({
      body: `새 본문 <@${mentionedId}>`,
      editedAt,
    });
    expect(rows[1]?.replyTo?.excerpt).toBe("새 본문 @김민지");
    expect(applyMessageEvent([reply()], updated(), new Map())).toHaveLength(1);
    expect(
      applyMessageEvent(
        rows,
        updated({ body: "과거", editedAt: "2026-10-07T00:00:00.000Z" }),
        new Map(),
      ),
    ).toEqual(rows);
  });

  it("removes body, mentions, reactions and reaction intentions when deleted", () => {
    const original = message(1, {
      mentions: [{ userId: mentionedId, name: "김민지" }],
      mentionsEveryone: true,
      reactions: [{ emoji: "heart", count: 1, mine: true, names: ["박지훈"] }],
      reactionIntents: { heart: { token: "intent", on: true } },
    });
    const rows = applyMessageEvent([original, reply()], deleted, new Map());
    expect(rows[0]).toMatchObject({
      body: "",
      deletedAt: expect.any(String),
      mentions: [],
      mentionsEveryone: false,
      reactions: [],
    });
    expect(rows[0]?.reactionIntents).toBeUndefined();
    expect(rows[1]?.replyTo).toMatchObject({
      deleted: true,
      excerpt: "삭제된 메시지예요",
    });
    expect(applyMessageEvent(rows, updated(), new Map())).toEqual(rows);
  });

  it("does not resurrect a deleted reply from late edit events or stale pages when the source is not loaded", () => {
    const rows = applyMessageEvent([reply()], deleted, new Map());
    expect(applyMessageEvent(rows, updated(), new Map())).toEqual(rows);
    expect(mergeChatMessages(rows, [reply()], userId)).toEqual(rows);
  });

  it("accepts deletion even when a local edit is newer, and never merges its old body back", () => {
    const edited = message(1, {
      body: "최신이지만 삭제된 비밀 본문",
      editedAt,
      mentionsEveryone: true,
    });
    const removed = message(1, {
      body: "",
      deletedAt: "2026-10-08T00:02:00.000Z",
    });
    const rows = mergeChatMessages([edited], [removed], userId);
    expect(rows).toEqual([removed]);
    expect(mergeChatMessages(rows, [edited, message(1)], userId)).toEqual(rows);
  });

  it("does not replace newer edited content with a delayed original created payload", () => {
    const edited = message(1, {
      body: "수정한 본문",
      editedAt,
      mentions: [{ userId: mentionedId, name: "김민지" }],
    });
    expect(mergeChatMessages([edited], [message(1)], userId)).toEqual([edited]);
  });
});
