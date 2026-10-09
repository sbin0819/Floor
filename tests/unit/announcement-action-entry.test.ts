import { beforeEach, expect, it, vi } from "vitest";
import { sendAnnouncement } from "@/features/admin/announcement-actions";
import { createAnnouncementActionFactory } from "@/features/admin/announcement-action-factory";

const calls = vi.hoisted(() => ({ sendAnnouncement: vi.fn() }));
vi.mock("@/features/admin/announcement-action-factory", () => ({
  createAnnouncementActionFactory: vi.fn(() => calls),
}));
beforeEach(() => vi.clearAllMocks());
it("forwards unknown input only through the authenticated announcement factory", async () => {
  const input = { branchId: "untrusted", actorId: "untrusted" };
  const result = { ok: false, code: "UNAUTHENTICATED" };
  calls.sendAnnouncement.mockResolvedValue(result);
  expect(await sendAnnouncement(input)).toEqual(result);
  expect(createAnnouncementActionFactory).toHaveBeenCalledExactlyOnceWith();
  expect(calls.sendAnnouncement).toHaveBeenCalledExactlyOnceWith(input);
});
