"use client";

import { useRef, useState } from "react";
import type { Photo } from "@/lib/photos/schema";
import { PhotoCarousel } from "./photo-carousel";
import { PhotoViewer } from "./photo-viewer";
import type { PhotoSpaceType } from "./space-photo";

export function PhotoGallery({
  photos,
  name,
  type,
  eager = false,
  sizes,
  className,
}: {
  photos: Photo[];
  name: string;
  type?: PhotoSpaceType;
  eager?: boolean;
  sizes?: string;
  className?: string;
}) {
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <PhotoCarousel
        key={photos.map(({ path }) => path).join("|")}
        photos={photos}
        name={name}
        type={type}
        eager={eager}
        sizes={sizes}
        className={className}
        onEnlarge={(index, trigger) => {
          triggerRef.current = trigger;
          setViewerIndex(index);
        }}
      />
      <PhotoViewer
        photos={photos}
        name={name}
        type={type}
        open={viewerIndex !== null}
        initialIndex={viewerIndex ?? 0}
        triggerRef={triggerRef}
        onOpenChange={(open) => {
          if (!open) setViewerIndex(null);
        }}
      />
    </>
  );
}
