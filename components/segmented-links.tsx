import type { ComponentProps } from "react";
import { Slot } from "radix-ui";
import { cn } from "cn";

export function SegmentedLinks({
  label,
  className,
  ...props
}: ComponentProps<"nav"> & { label: string }) {
  return (
    <nav
      aria-label={label}
      className={cn(
        "flex w-fit flex-wrap gap-1 rounded-lg bg-muted p-1",
        className,
      )}
      {...props}
    />
  );
}

export function SegmentedLink({
  selected,
  asChild = false,
  className,
  ...props
}: ComponentProps<"a"> & { selected: boolean; asChild?: boolean }) {
  const Element = asChild ? Slot.Root : "a";
  return (
    <Element
      aria-current={selected ? "page" : undefined}
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        selected
          ? "bg-card text-foreground shadow-card"
          : "text-muted-foreground hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}
