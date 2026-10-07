import { describe, expect, it } from "vitest";
import { normalizeTeamName } from "@/lib/teams/normalize";
import {
  createTeamSchema,
  createJoinRequestSchema,
  sendInviteSchema,
  inviteTokenSchema,
  teamSearchSchema,
} from "@/features/teams/schema";

const valid = {
  name: "Acme Inc",
  homeBranchId: crypto.randomUUID(),
  headcount: 4,
  contactPhone: "010-1234-5678",
  title: "디자이너",
};

describe("team input contracts", () => {
  it("shares NFC and whitespace normalization between creation and search", () => {
    const raw = "  Cafe\u0301\t  Inc\n ";
    expect(normalizeTeamName(raw)).toBe("Café Inc");
    expect(createTeamSchema.parse({ ...valid, name: raw }).name).toBe(
      "Café Inc",
    );
    expect(teamSearchSchema.parse(raw)).toBe("Café Inc");
  });
  it("preserves search wildcard characters as input data", () => {
    expect(teamSearchSchema.parse(" A%_\\ ")).toBe("A%_\\");
  });
  it.each(["", " ", "a", "a".repeat(41)])(
    "rejects invalid team names %s",
    (name) => {
      expect(createTeamSchema.safeParse({ ...valid, name }).success).toBe(
        false,
      );
      expect(teamSearchSchema.safeParse(name).success).toBe(false);
    },
  );
  it("accepts bounds and numeric form values without accepting booleans", () => {
    for (const headcount of [1, 1000, "5"])
      expect(createTeamSchema.safeParse({ ...valid, headcount }).success).toBe(
        true,
      );
    for (const headcount of [0, 1001, 1.5, "", null, true, false, "wrong"])
      expect(createTeamSchema.safeParse({ ...valid, headcount }).success).toBe(
        false,
      );
  });
  it("leaves branch requirements to the server's current branch inventory", () => {
    for (const homeBranchId of ["", undefined, null])
      expect(
        createTeamSchema.parse({ ...valid, homeBranchId }).homeBranchId,
      ).toBeNull();
    expect(
      createTeamSchema.safeParse({ ...valid, homeBranchId: "invalid" }).success,
    ).toBe(false);
  });
  it.each([
    [" +82 10-1234-5678 ", "+821012345678"],
    ["010-1234-5678", "01012345678"],
    ["010+1234-5678", "01012345678"],
  ])(
    "stores only digits and a leading plus from %s",
    (contactPhone, expected) => {
      expect(
        createTeamSchema.parse({ ...valid, contactPhone }).contactPhone,
      ).toBe(expected);
    },
  );
  it.each(["1234567", "1".repeat(16), "phone01012345678", "(010)12345678", ""])(
    "rejects invalid phone input %s",
    (contactPhone) => {
      expect(
        createTeamSchema.safeParse({ ...valid, contactPhone }).success,
      ).toBe(false);
    },
  );
  it("trims optional text and stores absence as null", () => {
    expect(createTeamSchema.parse({ ...valid, title: "  " }).title).toBeNull();
    expect(createTeamSchema.parse({ ...valid, title: "  리드  " }).title).toBe(
      "리드",
    );
    expect(
      createTeamSchema.safeParse({ ...valid, title: "x".repeat(41) }).success,
    ).toBe(false);
    expect(
      createJoinRequestSchema.parse({ teamId: crypto.randomUUID() }).message,
    ).toBeNull();
  });
  it("limits messages to 200 characters and lowercases invitation email", () => {
    const invite = {
      teamId: crypto.randomUUID(),
      email: " MEMBER@EXAMPLE.TEST ",
      message: " a ",
    };
    expect(sendInviteSchema.parse(invite)).toMatchObject({
      email: "member@example.test",
      message: "a",
    });
    expect(
      sendInviteSchema.safeParse({ ...invite, message: "x".repeat(201) })
        .success,
    ).toBe(false);
    expect(
      createJoinRequestSchema.safeParse({
        teamId: invite.teamId,
        message: "x".repeat(201),
      }).success,
    ).toBe(false);
  });
  it("rejects caller-supplied ownership and role fields", () => {
    expect(
      createTeamSchema.safeParse({ ...valid, userId: crypto.randomUUID() })
        .success,
    ).toBe(false);
    expect(
      sendInviteSchema.safeParse({
        teamId: crypto.randomUUID(),
        email: "member@example.test",
        role: "admin",
      }).success,
    ).toBe(false);
  });
  it("does not reveal token validity through schema error variants", () => {
    for (const token of ["", "invalid", "/not-a-token", "x".repeat(1000)])
      expect(inviteTokenSchema.safeParse({ token }).success).toBe(true);
    expect(inviteTokenSchema.safeParse({ token: null }).success).toBe(false);
  });
});
