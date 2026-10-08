import { describe, expect, it } from "vitest";
import {
  parseSystemMessageData,
  systemMessageDataSchema,
  systemMessageText,
  type SystemMessageData,
} from "@/features/chat/system-messages";

const changed = {
  type: "booking_time_changed" as const,
  actorName: "박지훈",
  timezone: "Asia/Seoul",
  previousStart: "2026-10-08T01:00:00.000Z",
  previousEnd: "2026-10-08T02:30:00.000Z",
  start: "2026-10-08T05:00:00.000Z",
  end: "2026-10-08T06:30:00.000Z",
};
describe("meeting system snapshots", () => {
  it.each<[SystemMessageData, string]>([
    [
      { type: "booking_created", actorName: "박지훈" },
      "박지훈 님이 예약을 만들었어요",
    ],
    [
      changed,
      "박지훈 님이 시간을 바꿨어요: 10월 8일 10:00–11:30 → 14:00–15:30",
    ],
    [
      {
        ...changed,
        start: "2026-10-09T05:00:00.000Z",
        end: "2026-10-09T06:30:00.000Z",
      },
      "박지훈 님이 시간을 바꿨어요: 10월 8일 10:00–11:30 → 10월 9일 14:00–15:30",
    ],
    [
      { ...changed, timezone: "America/Los_Angeles" },
      "박지훈 님이 시간을 바꿨어요: 10월 7일 18:00–19:30 → 22:00–23:30",
    ],
    [
      {
        type: "participants_added",
        actorName: "박지훈",
        names: ["이서연", "정유나", "최민준"],
      },
      "박지훈 님이 이서연, 정유나, 최민준 님을 참석자로 추가했어요",
    ],
    [
      {
        type: "participants_added",
        actorName: "박지훈",
        names: ["김하은", "이서연", "정유나", "최민준"],
      },
      "박지훈 님이 김하은, 이서연 외 2명 님을 참석자로 추가했어요",
    ],
    [
      { type: "participant_removed", actorName: "박지훈", names: ["이서연"] },
      "박지훈 님이 이서연 님을 참석자에서 뺐어요",
    ],
    [
      {
        type: "participant_removed",
        actorName: "박지훈",
        names: ["김하은", "이서연", "정유나", "최민준"],
      },
      "박지훈 님이 김하은, 이서연 외 2명 님을 참석자에서 뺐어요",
    ],
    [
      { type: "participant_left", name: "이서연" },
      "이서연 님이 참석하지 않기로 했어요",
    ],
    [
      { type: "booking_cancelled", actorName: "박지훈" },
      "박지훈 님이 예약을 취소했어요",
    ],
  ])(
    "formats $0.type using the reservation zone and name-only snapshots",
    (data, text) => {
      expect(systemMessageDataSchema.parse(data)).toEqual(data);
      expect(systemMessageText(data)).toBe(text);
    },
  );
  it.each([
    { ...changed, timezone: "not-a-zone" },
    { ...changed, start: "not-an-instant" },
    { ...changed, email: "private@example.test" },
    { type: "participants_added", actorName: "박지훈", names: [] },
    {
      type: "participant_removed",
      actorName: "박지훈",
      names: Array(21).fill("이서연"),
    },
    { type: "booking_created", actorName: "박지훈", userId: "private" },
  ])("rejects malformed or identifying extra values %#", (data) => {
    expect(parseSystemMessageData(data)).toBeNull();
  });
  it("allows exactly 20 participant names", () => {
    expect(
      parseSystemMessageData({
        type: "participants_added",
        actorName: "박지훈",
        names: Array(20).fill("이서연"),
      }),
    ).not.toBeNull();
  });
});
