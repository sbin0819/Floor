import type { ComponentProps } from "react";
import { cn } from "cn";

export type BookingChipKind = "upcoming" | "ongoing" | "past";
const styles: Record<BookingChipKind, string> = {
  upcoming: "bg-accent text-accent-foreground",
  ongoing: "bg-primary text-primary-foreground",
  past: "bg-muted text-muted-foreground",
};

export function BookingChip({
  kind,
  className,
  ...props
}: ComponentProps<"span"> & { kind: BookingChipKind }) {
  return (
    <span
      className={cn(
        "block min-w-0 truncate rounded-md px-2 py-1 text-xs tabular-nums",
        styles[kind],
        className,
      )}
      {...props}
    />
  );
}
