import { describe, expect, it } from "vitest";
import {
  photoAltSchema,
  photoPathSchema,
  photoSchema,
} from "@/lib/photos/schema";

describe("local photo contracts", () => {
  it.each(["/seed/photos/a-1.webp", "/photos/meeting_room.png", "/a.jpg"])(
    "accepts local photo path %s",
    (path) => {
      expect(photoPathSchema.parse(path)).toBe(path);
    },
  );

  it.each([
    "https://example.com/a.webp",
    "//example.com/a.webp",
    "/a/../b.webp",
    "seed/a.webp",
    "/a.gif",
    "/A.webp",
    "/seed/photos/awebp",
    "/seed/photos/a_png",
    "/seed//photos/a.webp",
    "/seed/photos/a.webp?size=20",
    "/seed/photos/a.webp\n",
  ])("rejects unsafe or unsupported photo path %s", (path) => {
    expect(photoPathSchema.safeParse(path).success).toBe(false);
  });

  it.each(["", "가".repeat(121), "🪑".repeat(121)])(
    "rejects invalid alt length",
    (alt) => {
      expect(photoAltSchema.safeParse(alt).success).toBe(false);
    },
  );

  it.each(["회의실 B 테이블과 화이트보드", "가".repeat(120), "🪑".repeat(120)])(
    "counts alt text as database characters",
    (alt) => expect(photoAltSchema.parse(alt)).toBe(alt),
  );

  it("keeps only the strict display contract", () => {
    const photo = { path: "/seed/photos/a-1.webp", alt: "회의실 책상" };
    expect(photoSchema.parse(photo)).toEqual(photo);
    expect(photoSchema.safeParse({ ...photo, sortOrder: 0 }).success).toBe(
      false,
    );
  });
});
