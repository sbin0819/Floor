import { beforeEach, expect, it, vi } from "vitest";
import * as actions from "@/features/admin/photo-actions";
import { createSpacePhotoActions } from "@/features/admin/photo-action-factory";

const calls = vi.hoisted(() => ({
  createSpacePhotoUpload: vi.fn(),
  confirmSpacePhotoUpload: vi.fn(),
  reorderSpacePhotos: vi.fn(),
  updateSpacePhotoAlt: vi.fn(),
  deleteSpacePhoto: vi.fn(),
}));
vi.mock("@/features/admin/photo-action-factory", () => ({
  createSpacePhotoActions: vi.fn(() => calls),
}));
beforeEach(() => vi.clearAllMocks());
it.each(Object.keys(calls) as (keyof typeof calls)[])(
  "forwards %s through the authenticated factory without trusting extra inputs",
  async (name) => {
    const input = { spaceId: "untrusted", userId: "untrusted" };
    const result = { ok: false, code: "UNAUTHENTICATED" };
    calls[name].mockResolvedValue(result);
    expect(await actions[name](input)).toEqual(result);
    expect(createSpacePhotoActions).toHaveBeenCalledExactlyOnceWith();
    expect(calls[name]).toHaveBeenCalledExactlyOnceWith(input);
  },
);
