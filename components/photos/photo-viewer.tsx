"use client";

import type { RefObject } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Photo } from "@/lib/photos/schema";
import { PhotoCarousel } from "./photo-carousel";
import type { PhotoSpaceType } from "./space-photo";

export function PhotoViewer({
  photos,
  name,
  type,
  open,
  onOpenChange,
  initialIndex = 0,
  triggerRef,
}: {
  photos: Photo[];
  name: string;
  type?: PhotoSpaceType;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialIndex?: number;
  triggerRef?: RefObject<HTMLElement | null>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] shadow-pop sm:max-w-5xl"
        onCloseAutoFocus={(event) => {
          const trigger = triggerRef?.current;
          if (trigger?.isConnected) {
            event.preventDefault();
            trigger.focus({ preventScroll: true });
          }
        }}
      >
        <DialogHeader className="pr-10">
          <DialogTitle className="text-lg font-bold">{name}</DialogTitle>
          <DialogDescription className="sr-only">
            공간의 사진을 크게 볼 수 있어요.
          </DialogDescription>
        </DialogHeader>
        <PhotoCarousel
          photos={photos}
          name={name}
          type={type}
          initialIndex={initialIndex}
          fit="contain"
          sizes="(max-width: 1023px) calc(100vw - 64px), 960px"
          className="h-[min(70dvh,750px)]"
        />
      </DialogContent>
    </Dialog>
  );
}
