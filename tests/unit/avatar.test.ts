import { describe, expect, it } from "vitest";
import {
  AVATAR_COLORS,
  avatarColorFor,
  avatarSchema,
  isAllowedAvatarPhoto,
  toAvatar,
} from "@/lib/avatar";

describe("avatar colors", () => {
  it("keeps the eight-color order shared by the database and browser", () => {
    expect(AVATAR_COLORS).toEqual([
      "blue",
      "green",
      "orange",
      "purple",
      "pink",
      "teal",
      "yellow",
      "gray",
    ]);
  });

  it.each([
    ["", "blue"],
    ["a", "green"],
    ["abcdefgh", "pink"],
    ["00000000-0000-4000-8000-000000000001", "green"],
    ["가", "orange"],
    ["😀", "gray"],
    ["é", "pink"],
    ["e\u0301", "orange"],
  ])("chooses a stable color from the UTF-8 bytes of %j", (id, expected) => {
    expect(avatarColorFor(id, null)).toBe(expected);
    expect(avatarColorFor(id, null)).toBe(expected);
  });

  it.each(AVATAR_COLORS)("prefers the chosen color %s", (color) => {
    expect(avatarColorFor("a", color)).toBe(color);
    expect(avatarColorFor("가😀", color)).toBe(color);
  });
});

describe("avatar photo allowlist", () => {
  it.each([
    "https://lh3.googleusercontent.com/a/photo=s96-c",
    "https://avatars.githubusercontent.com/u/123?v=4",
    "https://lh3.googleusercontent.com",
    "HTTPS://AVATARS.GITHUBUSERCONTENT.COM/u/1",
    "https://avatars.githubusercontent.com/u/1?size=64#photo",
    "https://lh3.googleusercontent.com/path:443/@photo",
  ])("allows the exact HTTPS provider address %s", (url) => {
    expect(isAllowedAvatarPhoto(url)).toBe(true);
  });

  it.each([
    "",
    "not a url",
    "/profile.png",
    "//lh3.googleusercontent.com/a/photo",
    "http://lh3.googleusercontent.com/a/photo",
    "data:image/png;base64,abc",
    "javascript:alert(1)",
    "https://example.com/profile.png",
    "https://lh3.googleusercontent.com.evil.test/photo",
    "https://sub.lh3.googleusercontent.com/photo",
    "https://avatars.githubusercontent.com.evil.test/photo",
    "https://avatars.githubusercontent.com./photo",
    "https://avatars.githubusercontent.com:443/photo",
    "https://avatars.githubusercontent.com:80/photo",
    "https://avatars.githubusercontent.com:/photo",
    "https://name@avatars.githubusercontent.com/photo",
    "https://name:password@avatars.githubusercontent.com/photo",
    "https://@avatars.githubusercontent.com/photo",
    "https://avatars.githubusercontent.com@evil.test/photo",
    "https://avatars.githubusercontent.com\\@evil.test/photo",
    "https://avatars.githubuserconte\nnt.com/photo",
    " https://avatars.githubusercontent.com/photo",
    "https://%61vatars.githubusercontent.com/photo",
  ])("rejects an unsafe or noncanonical address %j", (url) => {
    expect(isAllowedAvatarPhoto(url)).toBe(false);
  });
});

describe("avatar projection and browser schema", () => {
  const source = {
    id: "a",
    avatarColor: null,
    avatarPhoto: false,
    avatarUrl: "https://avatars.githubusercontent.com/u/123?v=4",
  };

  it("returns only the public avatar and does not mutate the source", () => {
    const input = Object.freeze(source);
    expect(toAvatar(input)).toEqual({ color: "green", photoUrl: null });
    expect(input).toEqual(source);
  });

  it("includes a permitted photo only when explicitly enabled", () => {
    expect(toAvatar({ ...source, avatarPhoto: true })).toEqual({
      color: "green",
      photoUrl: source.avatarUrl,
    });
    expect(
      toAvatar({ ...source, avatarColor: "pink", avatarPhoto: true }),
    ).toEqual({ color: "pink", photoUrl: source.avatarUrl });
  });

  it.each([null, "", "https://evil.test/avatar.png", "data:image/png,abc"])(
    "falls back to a color for a missing or disallowed photo %j",
    (avatarUrl) => {
      expect(toAvatar({ ...source, avatarPhoto: true, avatarUrl })).toEqual({
        color: "green",
        photoUrl: null,
      });
    },
  );

  it.each(AVATAR_COLORS)(
    "round-trips the public %s DTO without losing fields",
    (color) => {
      const value = toAvatar({
        ...source,
        avatarColor: color,
        avatarPhoto: true,
      });
      expect(avatarSchema.parse(JSON.parse(JSON.stringify(value)))).toEqual(
        value,
      );
      expect(avatarSchema.parse({ color, photoUrl: null })).toEqual({
        color,
        photoUrl: null,
      });
    },
  );

  it.each([
    {},
    { color: "blue" },
    { photoUrl: null },
    { color: "red", photoUrl: null },
    { color: "blue", photoUrl: undefined },
    { color: "blue", photoUrl: "https://evil.test/photo" },
    {
      color: "blue",
      photoUrl: "https://avatars.githubusercontent.com:443/u/1",
    },
    { color: "blue", photoUrl: null, avatarUrl: "https://evil.test/photo" },
    { color: "blue", photoUrl: null, id: "private-user-id" },
  ])("rejects malformed DTOs and unexpected fields: %j", (value) => {
    expect(avatarSchema.safeParse(value).success).toBe(false);
  });
});
