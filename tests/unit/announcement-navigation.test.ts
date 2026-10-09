import { describe, expect, it } from "vitest";
import {
  announcementPath,
  announcementPreviewHref,
  announcementPreviewRequest,
  announcementSendLabel,
  announcementTargetKey,
  type AnnouncementTargetInput,
} from "@/features/admin/announcement-navigation";

const branchId = "10000000-0000-4000-8000-000000000001";
const floorId = "20000000-0000-4000-8000-000000000001";
const spaceId = "30000000-0000-4000-8000-000000000001";
const nonce = "40000000-0000-4000-8000-000000000001";
describe("announcement preview URLs", () => {
  it.each([
    null,
    { date: "2026-10-14", floorId: null, spaceId: null },
    { date: "2026-10-14", floorId, spaceId },
  ])("round trips target %j without message content", (audience) => {
    const input: AnnouncementTargetInput = { branchId, lounge: true, audience };
    const request = { input, nonce, inputKey: announcementTargetKey(input) };
    const url = new URL(announcementPreviewHref(request), "https://floor.test");
    expect(url.pathname).toBe(announcementPath(branchId));
    expect(
      announcementPreviewRequest(
        branchId,
        Object.fromEntries(url.searchParams),
      ),
    ).toEqual(request);
    expect([...url.searchParams.keys()]).not.toEqual(
      expect.arrayContaining(["title", "body"]),
    );
  });
  it.each([
    { preview: "bad", lounge: "1" },
    { preview: nonce, lounge: ["1"] },
    { preview: nonce, lounge: "2" },
    { preview: nonce, lounge: "0", date: "2026-02-30" },
    { preview: nonce, lounge: "0", floor: floorId },
    { preview: nonce, lounge: "0", date: "2026-10-14", space: spaceId },
    { preview: nonce, lounge: "0", date: "2026-10-14", floor: "bad" },
  ])("rejects malformed or incomplete target %j", (search) => {
    expect(announcementPreviewRequest(branchId, search)).toBeNull();
  });
  it("only includes destination fields in the selection key", () => {
    expect(
      announcementTargetKey({ branchId, lounge: false, audience: null }),
    ).not.toBe(
      announcementTargetKey({ branchId, lounge: true, audience: null }),
    );
  });
  it.each([
    [true, true, 23, "보내기 · 라운지와 23명"],
    [false, true, 23, "보내기 · 23명"],
    [true, false, null, "보내기 · 라운지"],
    [false, false, null, "보내기"],
    [false, true, null, "받는 사람 확인 중"],
  ] as const)("labels %s/%s/%s", (lounge, audience, count, label) => {
    expect(announcementSendLabel(lounge, audience, count)).toBe(label);
  });
});
