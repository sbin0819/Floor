"use client";
import {
  useId,
  useState,
  type PointerEventHandler,
  type KeyboardEventHandler,
} from "react";
import { GripVertical, Trash2 } from "lucide-react";
import { SpacePhoto } from "@/components/photos/space-photo";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AdminSpacePhoto } from "../space-detail-types";

export function SpacePhotoCard({
  photo,
  index,
  disabled,
  onAlt,
  onCover,
  onDelete,
  onKeyDown,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  dragTarget,
}: {
  photo: AdminSpacePhoto;
  index: number;
  disabled: boolean;
  dragTarget: boolean;
  onAlt: (alt: string) => void;
  onCover: () => void;
  onDelete: () => void;
  onKeyDown: KeyboardEventHandler<HTMLElement>;
  onPointerDown: PointerEventHandler<HTMLButtonElement>;
  onPointerMove: PointerEventHandler<HTMLButtonElement>;
  onPointerUp: PointerEventHandler<HTMLButtonElement>;
  onPointerCancel: PointerEventHandler<HTMLButtonElement>;
}) {
  const id = useId();
  const [edit, setEdit] = useState({ base: photo.alt, value: photo.alt });
  const value = edit.base === photo.alt ? edit.value : photo.alt;
  return (
    <article
      data-photo-id={photo.id}
      tabIndex={0}
      aria-label={`사진 ${index + 1}`}
      onKeyDown={onKeyDown}
      className={`min-w-0 overflow-hidden rounded-xl border bg-card shadow-card focus-visible:outline-2 focus-visible:outline-ring ${dragTarget ? "ring-2 ring-ring" : ""}`}
    >
      <div className="relative aspect-[16/10]">
        <SpacePhoto
          photo={photo}
          type="meeting_room"
          size="fill"
          sizes="(max-width: 639px) 100vw, (max-width: 1279px) 50vw, 25vw"
        />
        {index === 0 && (
          <Badge className="absolute top-3 left-3 bg-card text-primary">
            대표 사진
          </Badge>
        )}
        <Button
          type="button"
          size="icon"
          variant="secondary"
          disabled={disabled}
          aria-label={`사진 ${index + 1} 순서 옮기기`}
          className="absolute top-2 right-2 touch-none bg-card"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
        >
          <GripVertical aria-hidden="true" />
        </Button>
      </div>
      <div className="space-y-3 p-3">
        <Label htmlFor={id} className="sr-only">
          사진 {index + 1} 설명
        </Label>
        <Input
          id={id}
          value={value}
          disabled={disabled}
          onChange={(event) =>
            setEdit({ base: photo.alt, value: event.target.value })
          }
          onBlur={() => {
            if (value !== photo.alt) onAlt(value);
          }}
        />
        <div className="flex min-h-11 items-center justify-end gap-2">
          {index > 0 && (
            <Button variant="ghost" disabled={disabled} onClick={onCover}>
              대표로
            </Button>
          )}
          <Button
            size="icon"
            variant="ghost"
            disabled={disabled}
            aria-label={`사진 ${index + 1} 지우기`}
            onClick={onDelete}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        </div>
      </div>
    </article>
  );
}
