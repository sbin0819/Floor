"use client";

import { useRef, useState, type ReactNode } from "react";
import type { UploadController } from "../upload-controller";

export function UploadDropArea({
  uploads,
  children,
}: {
  uploads: UploadController;
  children: ReactNode;
}) {
  const depth = useRef(0);
  const [dragging, setDragging] = useState(false);
  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      onDragEnter={(event) => {
        if (!Array.from(event.dataTransfer.types).includes("Files")) return;
        event.preventDefault();
        depth.current += 1;
        setDragging(true);
      }}
      onDragOver={(event) => {
        if (Array.from(event.dataTransfer.types).includes("Files"))
          event.preventDefault();
      }}
      onDragLeave={(event) => {
        if (!Array.from(event.dataTransfer.types).includes("Files")) return;
        depth.current = Math.max(0, depth.current - 1);
        if (!depth.current) setDragging(false);
      }}
      onDrop={(event) => {
        if (!Array.from(event.dataTransfer.types).includes("Files")) return;
        event.preventDefault();
        depth.current = 0;
        setDragging(false);
        uploads.add(Array.from(event.dataTransfer.files));
      }}
    >
      {children}
      {dragging && (
        <div
          role="status"
          className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-background/95 font-semibold"
        >
          여기에 놓으면 올라가요
        </div>
      )}
    </div>
  );
}
