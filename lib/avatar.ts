import { z } from "zod";

export const AVATAR_COLORS = [
  "blue",
  "green",
  "orange",
  "purple",
  "pink",
  "teal",
  "yellow",
  "gray",
] as const;

export type AvatarColor = (typeof AVATAR_COLORS)[number];

export function avatarColorFor(
  userId: string,
  chosen: AvatarColor | null,
): AvatarColor {
  if (chosen !== null) return chosen;
  const sum = new TextEncoder()
    .encode(userId)
    .reduce((total, byte) => total + byte, 0);
  return AVATAR_COLORS[sum % AVATAR_COLORS.length]!;
}

export function isAllowedAvatarPhoto(value: string): boolean {
  try {
    const url = new URL(value);
    // URL은 명시한 기본 포트(:443)를 지우므로 원래 authority도 확인한다.
    const authority = /^https:\/\/([^/?#]*)/iu.exec(value)?.[1];
    return (
      url.protocol === "https:" &&
      (url.hostname === "lh3.googleusercontent.com" ||
        url.hostname === "avatars.githubusercontent.com") &&
      url.port === "" &&
      url.username === "" &&
      url.password === "" &&
      authority?.toLowerCase() === url.hostname
    );
  } catch {
    return false;
  }
}

export const avatarSchema = z.strictObject({
  color: z.enum(AVATAR_COLORS),
  photoUrl: z.string().refine(isAllowedAvatarPhoto).nullable(),
});

export type Avatar = z.infer<typeof avatarSchema>;

export function toAvatar(user: {
  id: string;
  avatarColor: AvatarColor | null;
  avatarPhoto: boolean;
  avatarUrl: string | null;
}): Avatar {
  return {
    color: avatarColorFor(user.id, user.avatarColor),
    photoUrl:
      user.avatarPhoto &&
      user.avatarUrl !== null &&
      isAllowedAvatarPhoto(user.avatarUrl)
        ? user.avatarUrl
        : null,
  };
}
