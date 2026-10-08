import { describe, expect, it } from "vitest";
import {
  parseSystemMessageData,
  systemMessageDataSchema,
  systemMessageText,
  type SystemMessageData,
} from "@/features/chat/system-messages";

describe("system message snapshots", () => {
  it.each<[SystemMessageData, string]>([
    [
      { type: "group_created", actorName: "박지훈" },
      "박지훈 님이 그룹을 만들었어요",
    ],
    [
      {
        type: "members_added",
        actorName: "박지훈",
        names: ["이서연", "정유나"],
      },
      "박지훈 님이 이서연, 정유나 님을 추가했어요",
    ],
    [
      {
        type: "members_added",
        actorName: "박지훈",
        names: ["이서연", "정유나", "김하은"],
      },
      "박지훈 님이 이서연, 정유나, 김하은 님을 추가했어요",
    ],
    [
      {
        type: "members_added",
        actorName: "박지훈",
        names: ["이서연", "정유나", "김하은", "최민준"],
      },
      "박지훈 님이 이서연, 정유나 외 2명 님을 추가했어요",
    ],
    [{ type: "member_left", name: "이서연" }, "이서연 님이 나갔어요"],
    [
      { type: "room_renamed", actorName: "박지훈", name: "점심 메뉴" },
      "박지훈 님이 그룹 이름을 '점심 메뉴'(으)로 바꿨어요",
    ],
    [
      { type: "room_renamed", actorName: "박지훈", name: null },
      "박지훈 님이 그룹 이름을 지웠어요",
    ],
  ])("formats $0.type with names only", (data, expected) => {
    expect(systemMessageDataSchema.parse(data)).toEqual(data);
    expect(systemMessageText(data)).toBe(expected);
  });

  it.each([
    null,
    {},
    { type: "meeting_created" },
    { type: "group_created", actorName: "" },
    { type: "group_created", actorName: "김하은", actorId: "private" },
    { type: "member_left", name: "김하은", email: "private@floor.test" },
    { type: "members_added", actorName: "김하은", names: [] },
    {
      type: "members_added",
      actorName: "김하은",
      names: Array(10).fill("박지훈"),
    },
    {
      type: "members_added",
      actorName: "김하은",
      names: [{ name: "박지훈", id: "private" }],
    },
    { type: "room_renamed", actorName: "김하은", name: "" },
    { type: "room_renamed", actorName: "김하은", name: "😀".repeat(31) },
  ])("returns null for malformed or private data %#", (data) => {
    expect(parseSystemMessageData(data)).toBeNull();
  });

  it("accepts 9 added names and a 30-code-point name", () => {
    expect(
      parseSystemMessageData({
        type: "members_added",
        actorName: "김하은",
        names: Array(9).fill("박지훈"),
      }),
    ).not.toBeNull();
    expect(
      parseSystemMessageData({
        type: "room_renamed",
        actorName: "김하은",
        name: "😀".repeat(30),
      }),
    ).not.toBeNull();
  });
});
