import { describe, expect, it } from "vitest";
import {
  getAnnouncementsInputSchema,
  previewAnnouncementAudienceSchema,
  sendAnnouncementSchema,
  validateAnnouncementAudience,
} from "@/features/admin/announcement-schema";

const branchId = "a3b57c99-62bd-44fe-a1ac-fab0f14db062";
const floorId = "a3b57c99-62bd-44fe-a1ac-fab0f14db063";
const spaceId = "a3b57c99-62bd-44fe-a1ac-fab0f14db064";
const audience = { date: "2026-10-07", floorId: null, spaceId: null };
const preview = { branchId, lounge: false, audience };
const input = { ...preview, title: "제목", body: "내용" };
const context = {
  now: new Date("2026-10-07T03:10:00Z"),
  timezone: "Asia/Seoul",
  floors: [
    {
      id: floorId,
      name: "7F",
      spaces: [{ id: spaceId, name: "회의실", type: "meeting_room" as const }],
    },
  ],
};

describe("announcement inputs", () => {
  it("normalizes UUIDs and trims text without changing plain text or newlines", () => {
    expect(
      sendAnnouncementSchema.parse({
        ...input,
        branchId: branchId.toUpperCase(),
        title: "  공지  ",
        body: "  첫 줄\n\n둘째 줄 **강조**  ",
      }),
    ).toEqual({ ...input, title: "공지", body: "첫 줄\n\n둘째 줄 **강조**" });
  });
  it("counts Unicode code points at both text limits", () => {
    expect(
      sendAnnouncementSchema.safeParse({
        ...input,
        title: "😀".repeat(60),
        body: "😀".repeat(500),
      }).success,
    ).toBe(true);
    expect(
      sendAnnouncementSchema.safeParse({ ...input, title: "😀".repeat(61) })
        .success,
    ).toBe(false);
    expect(
      sendAnnouncementSchema.safeParse({ ...input, body: "😀".repeat(501) })
        .success,
    ).toBe(false);
  });
  it.each([
    "",
    "  ",
    "공\0지",
    "<@everyone>",
    "<@a3b57c99-62bd-44fe-a1ac-fab0f14db064>",
  ])("rejects empty, NUL, and mention syntax %j", (value) => {
    expect(
      sendAnnouncementSchema.safeParse({ ...input, title: value }).success,
    ).toBe(false);
    expect(
      sendAnnouncementSchema.safeParse({ ...input, body: value }).success,
    ).toBe(false);
  });
  it("permits an empty preview but requires a send destination", () => {
    const empty = { branchId, lounge: false, audience: null };
    expect(previewAnnouncementAudienceSchema.safeParse(empty).success).toBe(
      true,
    );
    expect(
      sendAnnouncementSchema.safeParse({ ...input, ...empty }).success,
    ).toBe(false);
    expect(
      sendAnnouncementSchema.safeParse({ ...input, ...empty, lounge: true })
        .success,
    ).toBe(true);
  });
  it("strictly rejects unknown keys and malformed audience values", () => {
    expect(
      getAnnouncementsInputSchema.safeParse({ branchId, userId: branchId })
        .success,
    ).toBe(false);
    for (const value of [
      { ...preview, title: "URL에 넣으면 안 돼요" },
      { ...preview, branchId: "bad" },
      { ...preview, lounge: "true" },
      { ...preview, audience: { ...audience, date: "2026-02-30" } },
      { ...preview, audience: { ...audience, spaceId } },
      { ...preview, audience: { ...audience, floorId: "bad" } },
      { ...preview, audience: { ...audience, recipientCount: 1 } },
    ])
      expect(previewAnnouncementAudienceSchema.safeParse(value).success).toBe(
        false,
      );
    expect(
      sendAnnouncementSchema.safeParse({ ...input, actorId: branchId }).success,
    ).toBe(false);
  });
  it("uses branch-local today and includes the thirtieth future date", () => {
    expect(validateAnnouncementAudience(audience, context)).toEqual({
      start: new Date("2026-10-06T15:00:00Z"),
      end: new Date("2026-10-07T15:00:00Z"),
    });
    expect(
      validateAnnouncementAudience(
        { ...audience, date: "2026-11-06" },
        context,
      ),
    ).not.toBeNull();
    for (const date of ["2026-10-06", "2026-11-07"])
      expect(() =>
        validateAnnouncementAudience({ ...audience, date }, context),
      ).toThrow(
        expect.objectContaining({
          code: "INVALID_INPUT",
          details: { fieldErrors: { date: expect.any(Array) } },
        }),
      );
    expect(validateAnnouncementAudience(null, context)).toBeNull();
  });
  it("validates the floor and space against the actual branch catalog", () => {
    expect(
      validateAnnouncementAudience({ ...audience, floorId, spaceId }, context),
    ).not.toBeNull();
    for (const target of [
      { floorId: branchId, spaceId: null },
      { floorId, spaceId: branchId },
      { floorId: null, spaceId },
    ])
      expect(() =>
        validateAnnouncementAudience({ ...audience, ...target }, context),
      ).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
  });
  it.each([
    ["2026-03-08", "2026-03-08T08:00:00Z", "2026-03-09T07:00:00Z"],
    ["2026-11-01", "2026-11-01T07:00:00Z", "2026-11-02T08:00:00Z"],
  ])("uses the complete local day across DST on %s", (date, start, end) => {
    expect(
      validateAnnouncementAudience(
        { ...audience, date },
        { ...context, now: new Date(start), timezone: "America/Los_Angeles" },
      ),
    ).toEqual({ start: new Date(start), end: new Date(end) });
  });
});
