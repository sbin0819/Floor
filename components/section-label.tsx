import type { HTMLAttributes } from "react";
import { cn } from "cn";

export function SectionLabel({
  as: Element = "p",
  className,
  ...props
}: HTMLAttributes<HTMLElement> & { as?: "p" | "h2" | "h3" }) {
  return (
    <Element
      className={cn("text-xs font-semibold text-muted-foreground", className)}
      {...props}
    />
  );
}
