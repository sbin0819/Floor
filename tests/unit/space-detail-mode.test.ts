import { describe, expect, it } from "vitest";
import {
  hasDeskSeats,
  spaceDetailMode,
} from "@/features/bookings/space-detail-mode";

const desk = { type: "desk_area" as const, bookable: false, deskCount: 24 };
describe("one space detail display/close rule", () => {
  it.each([
    [true, "timeline", false, "detail"],
    [true, "timeline", true, "detail"],
    [true, "list", false, "panel"],
    [false, "list", false, "sheet"],
    [false, "timeline", true, "sheet"],
  ] as const)(
    "renders desk wide=%s view=%s detail=%s as %s and clears the space",
    (wide, view, detail, mode) => {
      expect(spaceDetailMode({ wide, view, detail, space: desk })).toEqual({
        mode,
        desk: true,
        keepSpaceOnClose: false,
      });
    },
  );
  it("keeps existing URL fallback until the selected floor data is known", () => {
    expect(
      spaceDetailMode({ wide: true, view: "timeline", detail: false }).mode,
    ).toBe("strip");
    expect(
      spaceDetailMode({ wide: true, view: "timeline", detail: true }),
    ).toMatchObject({ mode: "detail", keepSpaceOnClose: true });
  });
  it("does not turn lounges, empty or directly bookable areas into seat pickers", () => {
    expect(hasDeskSeats({ ...desk, type: "lounge" })).toBe(false);
    expect(hasDeskSeats({ ...desk, deskCount: 0 })).toBe(false);
    expect(hasDeskSeats({ ...desk, bookable: true })).toBe(false);
    expect(hasDeskSeats(null)).toBe(false);
  });
});
