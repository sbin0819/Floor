import { describe, expect, it } from "vitest";
import { loungeAccessFrom } from "@/lib/permissions/lounge";

describe("lounge role settings", () => {
  it.each([
    [false, {}, true, false],
    [true, {}, true, true],
    [false, { user: ["branch.announce"] }, false, true],
    [true, { user: [], operator: [] }, false, false],
    [true, { user: ["branch.announce"], operator: [] }, false, true],
  ] as const)(
    "uses can() for staff=%s and settings=%j",
    (isStaff, settings, canWrite, isAdmin) => {
      const roleSettings = Object.fromEntries(
        Object.entries(settings).map(([role, permissions]) => [
          role,
          [...permissions],
        ]),
      );
      expect(loungeAccessFrom({ isStaff, roleSettings })).toEqual({
        canWrite,
        isAdmin,
      });
    },
  );
  it("never acquires team roles from a branch's configuration", () => {
    expect(
      loungeAccessFrom({
        isStaff: false,
        roleSettings: {
          user: [],
          team_admin: ["branch.announce", "chat.lounge"],
        },
      }),
    ).toEqual({ canWrite: false, isAdmin: false });
  });
});
