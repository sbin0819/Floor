"use client";

import Image from "next/image";
import { useState } from "react";
import {
  Armchair,
  Building2,
  Laptop,
  LockKeyhole,
  Monitor,
  Phone,
  Presentation,
  Users,
} from "lucide-react";
import { cn } from "cn";
import { Skeleton } from "@/components/ui/skeleton";
import type { Photo } from "@/lib/photos/schema";

export type PhotoSpaceType =
  | "meeting_room"
  | "seminar"
  | "phone_booth"
  | "desk_area"
  | "desk"
  | "lounge"
  | "branch";
export type PhotoSize = { width: number; height: number } | "fill";

const placeholders = {
  meeting_room: { icon: Users, label: "회의실" },
  seminar: { icon: Presentation, label: "세미나실" },
  phone_booth: { icon: Phone, label: "폰부스" },
  desk_area: { icon: Monitor, label: "데스크 구역" },
  desk: { icon: Laptop, label: "좌석" },
  lounge: { icon: Armchair, label: "라운지" },
  branch: { icon: Building2, label: "지점" },
} satisfies Record<PhotoSpaceType, { icon: typeof Users; label: string }>;

export function PhotoPlaceholder({
  type,
  restricted = false,
  decorative = false,
  className,
}: {
  type: PhotoSpaceType;
  restricted?: boolean;
  decorative?: boolean;
  className?: string;
}) {
  const Icon = restricted ? LockKeyhole : placeholders[type].icon;
  return (
    <span
      role={decorative ? undefined : "img"}
      aria-label={
        decorative
          ? undefined
          : restricted
            ? "전용 공간"
            : `${placeholders[type].label} 사진이 없어요`
      }
      aria-hidden={decorative || undefined}
      data-slot="photo-placeholder"
      className={cn(
        "flex h-full w-full items-center justify-center rounded-[inherit] bg-muted text-muted-foreground",
        restricted && "bg-status-maintenance-hatch",
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-6" />
    </span>
  );
}

export function PhotoSkeleton({ className }: { className?: string }) {
  return (
    <span
      data-slot="photo-skeleton"
      aria-busy="true"
      className={cn("absolute inset-0 block rounded-[inherit]", className)}
    >
      <span role="status" className="sr-only">
        사진을 불러오고 있어요
      </span>
      <Skeleton className="h-full w-full rounded-[inherit]" />
    </span>
  );
}

function PhotoImage({
  photo,
  type,
  sizes,
  decorative,
  eager,
  fit,
}: {
  photo: Photo;
  type: PhotoSpaceType;
  sizes: string;
  decorative: boolean;
  eager: boolean;
  fit: "cover" | "contain";
}) {
  const [state, setState] = useState<"loading" | "loaded" | "failed">(
    "loading",
  );
  if (state === "failed")
    return <PhotoPlaceholder type={type} decorative={decorative} />;
  return (
    <>
      <Image
        src={photo.path}
        unoptimized={photo.path.startsWith("/api/")}
        alt={decorative ? "" : photo.alt}
        fill
        sizes={sizes}
        loading={eager ? "eager" : "lazy"}
        fetchPriority={eager ? "high" : undefined}
        className={cn(
          "rounded-[inherit]",
          fit === "contain" ? "object-contain" : "object-cover",
        )}
        onLoad={() => setState("loaded")}
        onError={() => setState("failed")}
      />
      {state === "loading" && <PhotoSkeleton />}
    </>
  );
}

export function SpacePhoto({
  photo,
  type,
  size = { width: 64, height: 48 },
  decorative = false,
  restricted = false,
  eager = false,
  fit = "cover",
  sizes,
  className,
}: {
  photo: Photo | null;
  type: PhotoSpaceType;
  size?: PhotoSize;
  decorative?: boolean;
  restricted?: boolean;
  eager?: boolean;
  fit?: "cover" | "contain";
  sizes?: string;
  className?: string;
}) {
  return (
    <span
      data-slot="space-photo"
      aria-hidden={decorative || undefined}
      className={cn(
        "relative block shrink-0 overflow-hidden rounded-lg bg-muted",
        size === "fill" && "h-full w-full",
        className,
      )}
      style={size === "fill" ? undefined : size}
    >
      {photo && !restricted ? (
        <PhotoImage
          key={photo.path}
          photo={photo}
          type={type}
          decorative={decorative}
          eager={eager}
          fit={fit}
          sizes={
            sizes ??
            (size === "fill"
              ? "(max-width: 1023px) 100vw, 420px"
              : `${size.width}px`)
          }
        />
      ) : (
        <PhotoPlaceholder
          type={type}
          decorative={decorative}
          restricted={restricted}
        />
      )}
    </span>
  );
}
