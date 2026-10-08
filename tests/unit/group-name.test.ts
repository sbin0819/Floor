import { describe, expect, it } from "vitest";
import { groupDisplayName, groupNameSchema } from "@/features/chat/group-name";

describe("group display names", () => {
  it("trims optional names and counts Unicode characters", () => {
    expect(groupNameSchema.parse("  점심  ")).toBe("점심");
    expect(groupNameSchema.parse(" \n ")).toBeNull();
    expect(groupNameSchema.parse("😀".repeat(30))).toHaveLength(60);
    expect(groupNameSchema.safeParse("😀".repeat(31)).success).toBe(false);
  });
  it("uses an explicit name or three alphabetically sorted peers", () => {
    expect(groupDisplayName("회의", ["홍길동"])).toBe("회의");
    expect(
      groupDisplayName(null, ["최수빈", "박지훈", "김민수", "이서연"]),
    ).toBe("김민수, 박지훈, 이서연 외 1명");
    expect(groupDisplayName(null, ["이서연", "김민수", "박지훈"], 8)).toBe(
      "김민수, 박지훈, 이서연 외 5명",
    );
    expect(groupDisplayName(null, [])).toBe("그룹 대화");
  });
});
