import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTypingState, typingLabel } from "@/features/chat/typing";
import type { PresenceMember } from "@/lib/realtime/ably-browser-client";

const user = { id: "me", name: "김서연" };
const members = [
  user,
  { id: "a", name: "이도윤" },
  { id: "b", name: "박지훈" },
  { id: "c", name: "최유진" },
];
function member(
  clientId: string,
  data: unknown = { typing: true, name: "위조 이름" },
  timestamp = Date.now(),
  connectionId = "tab-a",
): PresenceMember {
  return { clientId, data, timestamp, connectionId };
}
function setup() {
  const publish = vi.fn();
  const state = createTypingState({ roomId: "room-a", user, members, publish });
  return { publish, state };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-08T00:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("typing presence", () => {
  it("sends the first input immediately and coalesces later input to one update per three seconds", async () => {
    const { state, publish } = setup();
    state.onInput("안");
    state.onInput("안녕");
    expect(publish).toHaveBeenCalledExactlyOnceWith({
      typing: true,
      name: user.name,
    });
    await vi.advanceTimersByTimeAsync(2_000);
    state.onInput("안녕하세요");
    await vi.advanceTimersByTimeAsync(999);
    expect(publish).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(publish).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3_999);
    expect(publish).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(publish).toHaveBeenLastCalledWith({ typing: false });
    state.dispose();
  });
  it.each(["empty", "sent"])(
    "stops on %s and cancels pending true updates",
    async (reason) => {
      const { state, publish } = setup();
      state.onInput("본문");
      state.onInput("수정 본문");
      if (reason === "empty") state.onInput("  \n");
      else state.stopTyping();
      state.stopTyping();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(publish.mock.calls).toEqual([
        [{ typing: true, name: user.name }],
        [{ typing: false }],
      ]);
      state.dispose();
    },
  );
  it("uses verified names, excludes self and strangers, and merges the same person's tabs", () => {
    const { state } = setup();
    state.receive([
      member("me"),
      member("stranger"),
      member("a"),
      member("a", { typing: true }, Date.now(), "tab-b"),
      member("b", { typing: false }),
      member("c", { status: "online", auto: false }),
    ]);
    expect(state.getSnapshot()).toBe("이도윤 님이 입력하고 있어요");
    state.setMembers([user]);
    expect(state.getSnapshot()).toBe("");
    state.dispose();
  });
  it("expires exactly seven seconds after the last SDK update even without leave", async () => {
    const { state } = setup();
    state.receive([member("a")]);
    await vi.advanceTimersByTimeAsync(6_000);
    state.receive([
      member("a", { typing: true }, Date.now(), "newer-tab"),
      member("a", { typing: true }, Date.now() - 6_000),
    ]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(state.getSnapshot()).toBe("이도윤 님이 입력하고 있어요");
    await vi.advanceTimersByTimeAsync(6_000);
    expect(state.getSnapshot()).toBe("");
    state.receive([member("a", { typing: true }, Date.now() - 8_000)]);
    expect(state.getSnapshot()).toBe("");
    state.dispose();
  });
  it("stops timers when hidden and can reactivate under StrictMode or Activity", async () => {
    const { state, publish } = setup();
    const listener = vi.fn();
    state.subscribe(listener);
    state.receive([member("a")]);
    state.onInput("입력");
    state.dispose();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(publish).toHaveBeenCalledTimes(1);
    state.activate();
    state.onInput("다시 입력");
    state.receive([member("b")]);
    expect(state.getSnapshot()).toBe("박지훈 님이 입력하고 있어요");
    expect(publish).toHaveBeenCalledTimes(2);
    state.dispose();
  });
  it.each([
    [[], ""],
    [["가"], "가 님이 입력하고 있어요"],
    [["가", "나"], "가, 나 님이 입력하고 있어요"],
    [["가", "나", "다"], "여러 명이 입력하고 있어요"],
  ] as const)("formats the typing line for %j", (names, expected) => {
    expect(typingLabel(names)).toBe(expected);
  });
});
