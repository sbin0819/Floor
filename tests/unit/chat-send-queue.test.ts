import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createChatSendQueue,
  type QueuedMessage,
} from "@/features/chat/send-queue";
import type { ActionResult } from "@/lib/actions/result";
import type { ChatMessage } from "@/features/chat/types";
import { emptyMessageDetails } from "@/features/chat/types";

function deferred() {
  let resolve!: (result: ActionResult<ChatMessage>) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<ActionResult<ChatMessage>>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function entry(
  body: string,
  send: QueuedMessage["send"],
  roomId = "room",
): QueuedMessage {
  return {
    roomId,
    send,
    message: {
      ...emptyMessageDetails(),
      id: body,
      clientId: body,
      seq: 0,
      authorId: "me",
      authorName: "박지훈",
      kind: "text",
      body,
      createdAt: "2026-10-08T00:00:00Z",
    },
  };
}
function setup() {
  let online = false;
  const confirmed = vi.fn();
  const failed = vi.fn();
  const queue = createChatSendQueue({
    online: () => online,
    confirmed,
    failed,
  });
  return {
    queue,
    confirmed,
    failed,
    connect() {
      online = true;
      queue.resume();
    },
  };
}
const success = (item: QueuedMessage, seq = 1): ActionResult<ChatMessage> => ({
  ok: true,
  data: { ...item.message, id: `saved-${item.message.id}`, seq },
});
async function flush() {
  await vi.advanceTimersByTimeAsync(0);
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("room send queue", () => {
  it("preserves attachment order and the client ID across a lost response", async () => {
    const { queue, connect, confirmed } = setup();
    const send = vi.fn<QueuedMessage["send"]>();
    const item = entry("attachments", send);
    item.message.body = "";
    item.message.attachments = ["second", "first"].map((id) => ({
      id,
      name: `${id}.pdf`,
      size: 42,
      kind: "file",
      width: null,
      height: null,
    }));
    send
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(success(item));
    queue.enqueue(item);
    expect(send).not.toHaveBeenCalled();
    connect();
    await flush();
    expect(queue.pending()).toBe(1);
    connect();
    await flush();
    const input = {
      roomId: "room",
      clientId: "attachments",
      body: "",
      attachmentIds: ["second", "first"],
    };
    expect(send.mock.calls).toEqual([[input], [input]]);
    expect(queue.pending()).toBe(0);
    expect(confirmed).toHaveBeenCalledOnce();
  });
  it("does not retry an unavailable attachment and forwards its safe field error", async () => {
    const { queue, connect, failed } = setup();
    const failure = {
      ok: false as const,
      code: "INVALID_INPUT" as const,
      fieldErrors: { attachmentIds: ["unavailable"] },
    };
    const send = vi.fn<QueuedMessage["send"]>().mockResolvedValue(failure);
    const item = entry("attachments", send);
    queue.enqueue(item);
    connect();
    await flush();
    connect();
    await flush();
    expect(queue.pending()).toBe(0);
    expect(send).toHaveBeenCalledOnce();
    expect(failed).toHaveBeenCalledWith(item, failure);
  });
  it("remembers recovery received before an in-flight network rejection", async () => {
    const { queue, connect } = setup();
    const gate = deferred();
    const send = vi
      .fn<QueuedMessage["send"]>()
      .mockReturnValueOnce(gate.promise)
      .mockImplementation(async (input) => success(entry(input.body, send)));
    queue.enqueue(entry("1", send));
    queue.enqueue(entry("2", send));
    connect();
    connect();
    gate.reject(new Error("late network error"));
    await flush();
    expect(send.mock.calls.map(([input]) => input.clientId)).toEqual([
      "1",
      "1",
      "2",
    ]);
    expect(queue.pending()).toBe(0);
  });
  it("queues offline and drains three messages strictly FIFO with the same client IDs", async () => {
    const { queue, connect, confirmed } = setup();
    const gates = [deferred(), deferred(), deferred()];
    let calls = 0;
    const send = vi.fn<QueuedMessage["send"]>(() => gates[calls++]!.promise);
    const items = [entry("1", send), entry("2", send), entry("3", send)];
    for (const item of items) queue.enqueue(item);
    expect(queue.pending()).toBe(3);
    expect(send).not.toHaveBeenCalled();
    connect();
    expect(send).toHaveBeenCalledTimes(1);
    gates[0]!.resolve(success(items[0]!));
    await flush();
    expect(send).toHaveBeenCalledTimes(2);
    gates[1]!.resolve(success(items[1]!, 2));
    await flush();
    expect(send).toHaveBeenCalledTimes(3);
    gates[2]!.resolve(success(items[2]!, 3));
    await flush();
    expect(send.mock.calls.map((call) => call[0])).toEqual(
      items.map((item) => ({
        roomId: "room",
        clientId: item.message.clientId,
        body: item.message.body,
      })),
    );
    expect(queue.pending()).toBe(0);
    expect(confirmed).toHaveBeenCalledTimes(3);
  });
  it("a rejection blocks later and newly added messages until reconnect", async () => {
    const { queue, connect, failed } = setup();
    const gate = deferred();
    const send = vi
      .fn<QueuedMessage["send"]>()
      .mockReturnValueOnce(gate.promise)
      .mockImplementation(async (input) => success(entry(input.body, send)));
    queue.enqueue(entry("1", send));
    queue.enqueue(entry("2", send));
    connect();
    gate.reject(new Error("connection token secret"));
    await flush();
    queue.enqueue(entry("3", send));
    await flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(failed).not.toHaveBeenCalled();
    expect(queue.pending("room")).toBe(3);
    connect();
    await flush();
    expect(send.mock.calls.map(([input]) => input.clientId)).toEqual([
      "1",
      "1",
      "2",
      "3",
    ]);
    expect(queue.pending()).toBe(0);
  });
  it.each([
    "INVALID_INPUT",
    "NOT_FOUND",
    "FORBIDDEN",
    "INTERNAL",
    "UNAUTHENTICATED",
  ] as const)("does not queue a %s server response", async (code) => {
    const { queue, connect, failed } = setup();
    const send = vi
      .fn<QueuedMessage["send"]>()
      .mockResolvedValue({ ok: false, code });
    const item = entry("1", send);
    queue.enqueue(item);
    connect();
    await flush();
    expect(queue.pending()).toBe(0);
    expect(failed).toHaveBeenCalledWith(item, { ok: false, code });
    connect();
    await flush();
    expect(send).toHaveBeenCalledOnce();
  });
  it("waits ten seconds for send_rate and preserves new arrivals behind the throttled entry", async () => {
    const { queue, connect } = setup();
    const send = vi
      .fn<QueuedMessage["send"]>()
      .mockResolvedValueOnce({
        ok: false,
        code: "LIMIT_EXCEEDED",
        message: "send_rate",
      })
      .mockImplementation(async (input) => success(entry(input.body, send)));
    queue.enqueue(entry("1", send));
    connect();
    await flush();
    queue.enqueue(entry("2", send));
    connect();
    await vi.advanceTimersByTimeAsync(9_999);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(send.mock.calls.map(([input]) => input.body)).toEqual([
      "1",
      "1",
      "2",
    ]);
    expect(queue.pending()).toBe(0);
  });
  it("deduplicates queued IDs, isolates rooms, and ignores completion after disposal", async () => {
    const { queue, connect, confirmed } = setup();
    const gate = deferred();
    const send = vi.fn(() => gate.promise);
    const item = entry("1", send);
    queue.enqueue(item);
    queue.enqueue(item);
    queue.enqueue(entry("1", send, "other"));
    expect(queue.pending()).toBe(2);
    expect(queue.pending("room")).toBe(1);
    connect();
    expect(send).toHaveBeenCalledTimes(2);
    queue.dispose();
    gate.resolve(success(item));
    await flush();
    expect(confirmed).not.toHaveBeenCalled();
    expect(queue.pending()).toBe(0);
  });
});
