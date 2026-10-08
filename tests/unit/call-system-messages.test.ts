import { describe, expect, it } from "vitest";
import {
  parseSystemMessageData,
  systemMessageText,
  type SystemMessageData,
} from "@/features/chat/system-messages";

describe("call system messages", () => {
  it.each<[SystemMessageData, string]>([
    [
      { type: "huddle_started", actorName: "박지훈" },
      "박지훈 님이 통화를 시작했어요",
    ],
    [
      { type: "huddle_ended", durationMinutes: 0 },
      "통화가 끝났어요 · 1분 미만",
    ],
    [{ type: "huddle_ended", durationMinutes: 1 }, "통화가 끝났어요 · 1분"],
    [{ type: "huddle_ended", durationMinutes: 23 }, "통화가 끝났어요 · 23분"],
  ])("formats %j", (data, expected) => {
    expect(parseSystemMessageData(data)).toEqual(data);
    expect(systemMessageText(data)).toBe(expected);
  });
  it.each([
    { type: "huddle_started", actorName: "" },
    { type: "huddle_started", actorName: "김하은", userId: "private" },
    { type: "huddle_ended", durationMinutes: -1 },
    { type: "huddle_ended", durationMinutes: 0.5 },
    { type: "huddle_ended", durationMinutes: 1, sessionId: "private" },
  ])("rejects malformed and extra data %j", (value) =>
    expect(parseSystemMessageData(value)).toBeNull(),
  );
});
