import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteMessage,
  editMessage,
  setReaction,
} from "@/features/chat/actions";
import { emptyMessageDetails, type ChatMessage } from "@/features/chat/types";
import {
  roomMessagesKey,
  type DisplayMessage,
} from "@/features/chat/components/message-state";
import {
  useMessageMutations,
  withReactionIntents,
} from "@/features/chat/components/use-message-mutations";
import type { ActionResult } from "@/lib/actions/result";

vi.mock("@/features/chat/actions", () => ({
  setReaction: vi.fn(),
  editMessage: vi.fn(),
  deleteMessage: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
function message(): ChatMessage {
  return {
    authorAvatar: { color: "blue" as const, photoUrl: null },
    ...emptyMessageDetails(),
    id: "message",
    seq: 1,
    authorId: "me",
    authorName: "지훈",
    body: "원문",
    kind: "text",
    createdAt: "2026-10-08T00:00:00Z",
    clientId: null,
    reactions: [
      { emoji: "heart", count: 2, mine: false, names: ["서연", "지민"] },
    ],
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup() {
  const client = new QueryClient();
  client.setQueryData(roomMessagesKey("room"), [message()]);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    ({ room }) =>
      useMessageMutations({
        roomId: room,
        userId: "me",
        members: [{ id: "me", name: "지훈" }],
      }),
    { wrapper, initialProps: { room: "room" } },
  );
  const row = () =>
    client.getQueryData<DisplayMessage[]>(roomMessagesKey("room"))![0]!;
  return { ...hook, client, row };
}
beforeEach(() => vi.resetAllMocks());
describe("message action optimistic state", () => {
  it("shows a reaction immediately and removes only its intent on failure, retaining incoming canonical changes", async () => {
    const pending = deferred<ActionResult<{ count: number; mine: boolean }>>();
    vi.mocked(setReaction).mockReturnValue(pending.promise);
    const view = setup();
    let result!: Promise<boolean>;
    act(() => {
      result = view.result.current.react(message(), "heart", true);
    });
    expect(withReactionIntents(view.row()).reactions[0]).toMatchObject({
      count: 3,
      mine: true,
    });
    view.client.setQueryData<DisplayMessage[]>(
      roomMessagesKey("room"),
      (rows) =>
        rows!.map((row) => ({
          ...row,
          reactions: [
            { emoji: "heart", count: 4, mine: false, names: ["새 이름"] },
          ],
        })),
    );
    await act(async () => {
      pending.resolve({ ok: false, code: "INTERNAL" });
      await result;
    });
    expect(withReactionIntents(view.row()).reactions[0]).toEqual({
      emoji: "heart",
      count: 4,
      mine: false,
      names: ["새 이름"],
    });
  });
  it("does not overwrite newer server counts with an old action count", async () => {
    const pending = deferred<ActionResult<{ count: number; mine: boolean }>>();
    vi.mocked(setReaction).mockReturnValue(pending.promise);
    const view = setup();
    let result!: Promise<boolean>;
    act(() => {
      result = view.result.current.react(message(), "heart", true);
    });
    view.client.setQueryData<DisplayMessage[]>(
      roomMessagesKey("room"),
      (rows) =>
        rows!.map((row) => ({
          ...row,
          reactions: [
            { emoji: "heart", count: 8, mine: true, names: ["서연"] },
          ],
        })),
    );
    await act(async () => {
      pending.resolve({ ok: true, data: { count: 3, mine: true } });
      await result;
    });
    expect(withReactionIntents(view.row()).reactions[0]).toMatchObject({
      count: 8,
      mine: true,
    });
  });
  it("keeps a newer intent when an earlier click fails and serializes writes", async () => {
    const first = deferred<ActionResult<{ count: number; mine: boolean }>>();
    const second = deferred<ActionResult<{ count: number; mine: boolean }>>();
    vi.mocked(setReaction)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const view = setup();
    let a!: Promise<boolean>;
    let b!: Promise<boolean>;
    act(() => {
      a = view.result.current.react(message(), "heart", true);
      b = view.result.current.react(message(), "heart", false);
    });
    await waitFor(() => expect(setReaction).toHaveBeenCalledTimes(1));
    await act(async () => {
      first.resolve({ ok: false, code: "INTERNAL" });
      await a;
    });
    expect(view.row().reactionIntents?.heart?.on).toBe(false);
    await act(async () => {
      second.resolve({ ok: true, data: { count: 2, mine: false } });
      await b;
    });
    expect(withReactionIntents(view.row()).reactions[0]).toMatchObject({
      count: 2,
      mine: false,
    });
    expect(view.row().reactionIntents?.heart).toBeUndefined();
  });
  it("never restores reactions on a message deleted during the action", async () => {
    const pending = deferred<ActionResult<{ count: number; mine: boolean }>>();
    vi.mocked(setReaction).mockReturnValue(pending.promise);
    const view = setup();
    let result!: Promise<boolean>;
    act(() => {
      result = view.result.current.react(message(), "heart", true);
    });
    view.client.setQueryData(roomMessagesKey("room"), [
      {
        ...message(),
        body: "",
        deletedAt: "2026-10-08T01:00:00Z",
        reactions: [],
      },
    ]);
    await act(async () => {
      pending.resolve({ ok: true, data: { count: 3, mine: true } });
      await result;
    });
    expect(view.row()).toMatchObject({ body: "", reactions: [] });
  });
  it("keeps edit input open on failure and ignores an older edit result after deletion", async () => {
    vi.mocked(editMessage).mockResolvedValueOnce({
      ok: false,
      code: "NOT_FOUND",
    });
    const view = setup();
    await act(async () =>
      expect(await view.result.current.edit("message", "변경")).toBe(false),
    );
    expect(view.row().body).toBe("원문");
    const pending = deferred<ActionResult<ChatMessage>>();
    vi.mocked(editMessage).mockReturnValue(pending.promise);
    let result!: Promise<boolean>;
    act(() => {
      result = view.result.current.edit("message", "변경");
    });
    view.client.setQueryData(roomMessagesKey("room"), [
      { ...message(), body: "", deletedAt: "2026-10-08T01:00:00Z" },
    ]);
    await act(async () => {
      pending.resolve({
        ok: true,
        data: { ...message(), body: "변경", editedAt: "2026-10-08T00:30:00Z" },
      });
      await result;
    });
    expect(view.row().body).toBe("");
  });
  it("limits a late deletion result to its original room and clears reply excerpts", async () => {
    const pending = deferred<ActionResult<{ id: string }>>();
    vi.mocked(deleteMessage).mockReturnValue(pending.promise);
    const view = setup();
    view.client.setQueryData(roomMessagesKey("room"), [
      message(),
      {
        ...message(),
        id: "reply",
        seq: 2,
        replyTo: {
          attachmentSummary: null,
          id: "message",
          authorName: "지훈",
          excerpt: "원문",
          deleted: false,
        },
      },
    ]);
    view.client.setQueryData(roomMessagesKey("other"), [message()]);
    let result!: Promise<boolean>;
    act(() => {
      result = view.result.current.remove("message");
    });
    view.rerender({ room: "other" });
    await act(async () => {
      pending.resolve({ ok: true, data: { id: "message" } });
      await result;
    });
    expect(view.row()).toMatchObject({ body: "", mentions: [], reactions: [] });
    expect(
      view.client.getQueryData<DisplayMessage[]>(roomMessagesKey("room"))![1]!
        .replyTo,
    ).toMatchObject({ deleted: true, excerpt: "삭제된 메시지예요" });
    expect(
      view.client.getQueryData<DisplayMessage[]>(roomMessagesKey("other"))![0]!
        .body,
    ).toBe("원문");
  });
});
