import { beforeEach, expect, it, vi } from "vitest";
import { cancelBookingAsOperator } from "@/features/admin/booking-actions";
import { createCancelBookingAsOperator } from "@/features/admin/booking-action-factory";
import type { ActionResult } from "@/lib/actions/result";

const mocks = vi.hoisted(() => ({
  action:
    vi.fn<(input: unknown) => Promise<ActionResult<{ bookingId: string }>>>(),
}));
vi.mock("@/features/admin/booking-action-factory", () => ({
  createCancelBookingAsOperator: vi.fn(() => mocks.action),
}));
beforeEach(() => vi.clearAllMocks());
it.each([
  { ok: true, data: { bookingId: "booking" } },
  { ok: false, code: "FORBIDDEN" },
  { ok: false, code: "INVALID_INPUT", message: "not_cancellable" },
] satisfies ActionResult<{ bookingId: string }>[])(
  "delegates one untrusted argument and preserves the factory result %j",
  async (result) => {
    mocks.action.mockResolvedValue(result);
    const input = {
      bookingId: "booking",
      preset: "운영 사정",
      text: "이유",
      userId: "untrusted",
    };
    expect(await cancelBookingAsOperator(input)).toEqual(result);
    expect(createCancelBookingAsOperator).toHaveBeenCalledExactlyOnceWith();
    expect(mocks.action).toHaveBeenCalledExactlyOnceWith(input);
  },
);
