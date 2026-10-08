"use client";

import { useState, type ReactNode } from "react";
import { cn } from "cn";
import type { Avatar, AvatarColor } from "@/lib/avatar";

export const avatarColorClasses: Record<AvatarColor, string> = {
  blue: "bg-avatar-blue text-avatar-blue-foreground",
  green: "bg-avatar-green text-avatar-green-foreground",
  orange: "bg-avatar-orange text-avatar-orange-foreground",
  purple: "bg-avatar-purple text-avatar-purple-foreground",
  pink: "bg-avatar-pink text-avatar-pink-foreground",
  teal: "bg-avatar-teal text-avatar-teal-foreground",
  yellow: "bg-avatar-yellow text-avatar-yellow-foreground",
  gray: "bg-avatar-gray text-avatar-gray-foreground",
};
const sizes = {
  20: "size-5 text-xs",
  24: "size-6 text-xs",
  28: "size-7 text-xs",
  30: "size-[30px] text-xs",
  32: "size-8 text-sm",
  34: "size-[34px] text-sm",
  36: "size-9 text-sm",
  40: "size-10 text-base",
  60: "size-[60px] text-xl",
  64: "size-16 text-xl",
  72: "size-[72px] text-2xl",
} as const;

export function UserAvatar({
  name,
  avatar,
  size = 36,
  alt = "",
  status,
  className,
}: {
  name: string;
  avatar: Avatar;
  size?: keyof typeof sizes;
  alt?: string;
  status?: ReactNode;
  className?: string;
}) {
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
  const photo = avatar.photoUrl && avatar.photoUrl !== failedPhoto;
  return (
    <span
      data-user-avatar=""
      className={cn("relative inline-flex shrink-0", sizes[size], className)}
    >
      <span
        aria-hidden={alt ? undefined : true}
        role={alt ? "img" : undefined}
        aria-label={alt || undefined}
        className={cn(
          "flex size-full items-center justify-center overflow-hidden rounded-full font-semibold",
          avatarColorClasses[avatar.color],
        )}
      >
        {photo ? (
          // 허용한 제공자 사진은 브라우저가 직접 받으며 서버 이미지 프록시를 거치지 않는다.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatar.photoUrl!}
            alt=""
            referrerPolicy="no-referrer"
            loading="lazy"
            decoding="async"
            className="size-full object-cover"
            onError={() => setFailedPhoto(avatar.photoUrl)}
          />
        ) : (
          (Array.from(name)[0] ?? "?")
        )}
      </span>
      {status && (
        <span className="absolute -right-1 -bottom-1 flex rounded-full bg-card p-0.5">
          {status}
        </span>
      )}
    </span>
  );
}
