"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import type { Photo } from "@/lib/photos/schema";
import { photoIndexAtOffset } from "./photo-position";
import { SpacePhoto, type PhotoSpaceType } from "./space-photo";

export function PhotoCarousel({
  photos,
  name,
  type = "meeting_room",
  initialIndex = 0,
  eager = false,
  fit = "cover",
  sizes = "(max-width: 1023px) 100vw, 420px",
  className,
  onEnlarge,
}: {
  photos: Photo[];
  name: string;
  type?: PhotoSpaceType;
  initialIndex?: number;
  eager?: boolean;
  fit?: "cover" | "contain";
  sizes?: string;
  className?: string;
  onEnlarge?: (index: number, trigger: HTMLButtonElement) => void;
}) {
  const [selectedIndex, setSelectedIndex] = useState(initialIndex);
  const index = Math.max(0, Math.min(photos.length - 1, selectedIndex));
  const viewport = useRef<HTMLDivElement>(null);
  const photoButtons = useRef<(HTMLButtonElement | null)[]>([]);

  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element || element.clientWidth === 0) return;
    element.scrollTo({
      left:
        Math.max(0, Math.min(photos.length - 1, initialIndex)) *
        element.clientWidth,
      behavior: "instant",
    });
  }, [initialIndex, photos.length]);

  const move = (nextIndex: number, focusPhoto = false) => {
    const element = viewport.current;
    if (!element) return;
    const next = Math.max(0, Math.min(photos.length - 1, nextIndex));
    element.scrollTo({ left: next * element.clientWidth, behavior: "auto" });
    if (focusPhoto) photoButtons.current[next]?.focus({ preventScroll: true });
  };

  return (
    <div
      role="group"
      aria-roledescription="캐러셀"
      aria-label={`${name} 사진`}
      className={cn(
        "relative h-40 w-full overflow-hidden rounded-lg bg-muted",
        className,
      )}
      onKeyDown={(event) => {
        if (
          photos.length < 2 ||
          event.defaultPrevented ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          !["ArrowLeft", "ArrowRight"].includes(event.key)
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        const focusedPhoto = photoButtons.current.some(
          (button) => button === event.target,
        );
        move(index + (event.key === "ArrowRight" ? 1 : -1), focusedPhoto);
      }}
    >
      {photos.length === 0 ? (
        <SpacePhoto photo={null} type={type} size="fill" />
      ) : (
        <div
          ref={viewport}
          data-slot="photo-viewport"
          className="flex h-full w-full snap-x snap-mandatory [scrollbar-width:none] overflow-x-auto overscroll-x-contain scroll-smooth rounded-[inherit] motion-reduce:scroll-auto [&::-webkit-scrollbar]:hidden"
          onScroll={(event) => {
            const element = event.currentTarget;
            setSelectedIndex(
              photoIndexAtOffset(
                element.scrollLeft,
                element.clientWidth,
                photos.length,
              ),
            );
          }}
        >
          {photos.map((photo, photoIndex) => (
            <div
              key={photo.path}
              role="group"
              aria-roledescription="슬라이드"
              aria-label={`${photos.length}장 중 ${photoIndex + 1}번째`}
              aria-hidden={photoIndex !== index || undefined}
              className="h-full w-full shrink-0 snap-center rounded-[inherit]"
            >
              {onEnlarge ? (
                <button
                  ref={(element) => {
                    photoButtons.current[photoIndex] = element;
                  }}
                  type="button"
                  aria-label="사진 크게 보기"
                  tabIndex={photoIndex === index ? 0 : -1}
                  className="block h-full w-full cursor-zoom-in rounded-[inherit] focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-ring"
                  onClick={(event) =>
                    onEnlarge(photoIndex, event.currentTarget)
                  }
                >
                  <SpacePhoto
                    photo={photo}
                    type={type}
                    size="fill"
                    sizes={sizes}
                    eager={eager && photoIndex === 0}
                    fit={fit}
                  />
                </button>
              ) : (
                <SpacePhoto
                  photo={photo}
                  type={type}
                  size="fill"
                  sizes={sizes}
                  eager={eager && photoIndex === 0}
                  fit={fit}
                />
              )}
            </div>
          ))}
        </div>
      )}
      {photos.length > 1 && (
        <>
          <Button
            type="button"
            variant="secondary"
            size="icon"
            aria-label="이전 사진"
            disabled={index === 0}
            className="absolute top-1/2 left-2 -translate-y-1/2 rounded-full bg-card/95 shadow-card"
            onClick={() => move(index - 1)}
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="icon"
            aria-label="다음 사진"
            disabled={index === photos.length - 1}
            className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full bg-card/95 shadow-card"
            onClick={() => move(index + 1)}
          >
            <ChevronRight aria-hidden="true" />
          </Button>
          <div
            data-slot="photo-dots"
            aria-hidden="true"
            className="pointer-events-none absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5 rounded-full bg-card/90 px-2 py-1.5"
          >
            {photos.map((photo, photoIndex) => (
              <span
                key={photo.path}
                className={cn(
                  "size-1.5 rounded-full",
                  photoIndex === index ? "bg-foreground" : "bg-input",
                )}
              />
            ))}
          </div>
          <span
            aria-live="polite"
            aria-atomic="true"
            className="pointer-events-none absolute right-3 bottom-2 rounded-full bg-card/90 px-2 py-1 text-xs tabular-nums"
          >
            {index + 1} / {photos.length}
          </span>
        </>
      )}
    </div>
  );
}
