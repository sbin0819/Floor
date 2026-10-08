import { describe, expect, it, vi } from "vitest";
import {
  createRoomCatchUp,
  type LoadMessagePage,
} from "@/features/chat/catch-up";
import type { ChatMessage, RoomMessagesPage } from "@/features/chat/types";
import { emptyMessageDetails } from "@/features/chat/types";

const message = (seq: number): ChatMessage => ({
  ...emptyMessageDetails(),
  id: `message-${seq}`,
  seq,
  authorId: "other",
  authorName: "이서연",
  kind: "text",
  body: `${seq}번째`,
  createdAt: "2026-10-08T00:00:00Z",
  clientId: null,
});
const page = (
  seqs: number[],
  extra: Partial<RoomMessagesPage> = {},
): RoomMessagesPage => ({
  messages: seqs.map(message),
  lastSeq: Math.max(0, ...seqs),
  peerReadSeq: null,
  hasMore: false,
  lastReadSeq: null,
  firstUnreadSeq: null,
  ...extra,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup(loadPage: LoadMessagePage) {
  const merge = vi.fn();
  const replace = vi.fn();
  const controller = createRoomCatchUp({
    roomId: "room-a",
    loadPage,
    merge,
    replace,
  });
  controller.start(10);
  return { controller, merge, replace };
}

describe("room catch-up continuity", () => {
  it("fetches behind a gap rather than behind the newly observed maximum", async () => {
    const load = vi.fn<LoadMessagePage>().mockResolvedValue(page([11, 12, 13]));
    const { controller, merge } = setup(load);
    controller.receive(13);
    await vi.waitFor(() =>
      expect(merge).toHaveBeenCalledExactlyOnceWith([
        message(11),
        message(12),
        message(13),
      ]),
    );
    expect(load).toHaveBeenCalledWith(
      "room-a",
      { after: 10 },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    await controller.sync();
    expect(load).toHaveBeenLastCalledWith(
      "room-a",
      { after: 13 },
      expect.anything(),
    );
    controller.stop();
  });
  it("never fetches for contiguous, repeated or old events", () => {
    const load = vi.fn<LoadMessagePage>();
    const { controller } = setup(load);
    controller.receive(11);
    controller.receive(11);
    controller.receive(3);
    controller.receive(12);
    expect(load).not.toHaveBeenCalled();
    controller.stop();
  });
  it("serializes gap filling and follows up only while a gap remains", async () => {
    const first = deferred<RoomMessagesPage>();
    const load = vi
      .fn<LoadMessagePage>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(page([14, 15]));
    const { controller, merge } = setup(load);
    controller.receive(13);
    controller.receive(15);
    controller.receive(13);
    expect(load).toHaveBeenCalledTimes(1);
    first.resolve(page([11, 12, 13]));
    await vi.waitFor(() => expect(merge).toHaveBeenCalledTimes(2));
    expect(load.mock.calls.map(([, query]) => query)).toEqual([
      { after: 10 },
      { after: 13 },
    ]);
    controller.stop();
  });
  it("does not run an extra request if later events were already covered", async () => {
    const first = deferred<RoomMessagesPage>();
    const load = vi.fn<LoadMessagePage>().mockReturnValue(first.promise);
    const { controller, merge } = setup(load);
    controller.receive(13);
    controller.receive(15);
    first.resolve(page([11, 12, 13, 14, 15]));
    await vi.waitFor(() => expect(merge).toHaveBeenCalledTimes(1));
    expect(load).toHaveBeenCalledTimes(1);
    controller.stop();
  });
  it("keeps reconnect feedback visible until the response is merged", async () => {
    const pending = deferred<RoomMessagesPage>();
    const load = vi.fn<LoadMessagePage>().mockReturnValue(pending.promise);
    const { controller, merge } = setup(load);
    controller.disconnected();
    controller.connected();
    expect(controller.getSnapshot().reconnecting).toBe(true);
    pending.resolve(page([11]));
    await vi.waitFor(() =>
      expect(controller.getSnapshot().reconnecting).toBe(false),
    );
    expect(merge).toHaveBeenCalledWith([message(11)]);
    controller.stop();
  });
  it("retains reconnect feedback on failure and retries from the unchanged cursor", async () => {
    const load = vi
      .fn<LoadMessagePage>()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(page([11]));
    const { controller } = setup(load);
    await controller.sync();
    expect(controller.getSnapshot().reconnecting).toBe(true);
    await controller.sync();
    expect(load.mock.calls.map(([, query]) => query)).toEqual([
      { after: 10 },
      { after: 10 },
    ]);
    expect(controller.getSnapshot().reconnecting).toBe(false);
    controller.stop();
  });
  it("restarts at the newest fifty after a larger gap and resets read metadata", async () => {
    const recent = page(
      Array.from({ length: 50 }, (_, index) => index + 252),
      { lastReadSeq: 15, firstUnreadSeq: 16 },
    );
    const load = vi
      .fn<LoadMessagePage>()
      .mockResolvedValueOnce(
        page(
          Array.from({ length: 200 }, (_, index) => index + 11),
          { hasMore: true, lastSeq: 301 },
        ),
      )
      .mockResolvedValueOnce(recent);
    const { controller, merge, replace } = setup(load);
    await controller.sync();
    expect(load.mock.calls.map(([, query]) => query)).toEqual([
      { after: 10 },
      { before: 302 },
    ]);
    expect(merge).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledExactlyOnceWith(recent.messages);
    expect(controller.getSnapshot().historyReset).toEqual({
      version: 1,
      lastReadSeq: 15,
      firstUnreadSeq: 16,
    });
    controller.stop();
  });
  it("does not lose a live event that arrived during the newest-fifty reset", async () => {
    const recent = deferred<RoomMessagesPage>();
    const load = vi
      .fn<LoadMessagePage>()
      .mockResolvedValueOnce(page([11], { hasMore: true, lastSeq: 301 }))
      .mockReturnValueOnce(recent.promise)
      .mockResolvedValueOnce(page([302, 303]));
    const { controller, merge } = setup(load);
    const completion = controller.sync();
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    controller.receive(303);
    recent.resolve(page([300, 301]));
    await completion;
    expect(load.mock.calls.map(([, query]) => query)).toEqual([
      { after: 10 },
      { before: 302 },
      { after: 301 },
    ]);
    expect(merge).toHaveBeenCalledWith([message(302), message(303)]);
    controller.stop();
  });
  it("aborts and ignores responses after leaving the room", async () => {
    const pending = deferred<RoomMessagesPage>();
    const load = vi.fn<LoadMessagePage>().mockReturnValue(pending.promise);
    const { controller, merge } = setup(load);
    const completion = controller.sync();
    controller.stop();
    expect(load.mock.calls[0]?.[2]?.signal?.aborted).toBe(true);
    pending.resolve(page([11]));
    await completion;
    expect(merge).not.toHaveBeenCalled();
  });
  it("does not loop forever when the server cannot confirm the event", async () => {
    const load = vi
      .fn<LoadMessagePage>()
      .mockResolvedValue(page([], { lastSeq: 10 }));
    const { controller } = setup(load);
    controller.receive(13);
    await vi.waitFor(() =>
      expect(controller.getSnapshot().reconnecting).toBe(true),
    );
    expect(load).toHaveBeenCalledTimes(2);
    controller.stop();
  });
});
