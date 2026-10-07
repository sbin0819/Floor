import type { ComponentProps } from "react";
import { cn } from "cn";

export type StatusLineKind = "free" | "busy" | "mine" | "maintenance" | "none";

const styles: Record<StatusLineKind, { text: string; dot: string }> = {
  free: { text: "text-status-free-foreground", dot: "bg-status-free-strong" },
  busy: { text: "text-secondary-foreground", dot: "bg-booked-strong" },
  mine: { text: "text-accent-foreground", dot: "bg-primary" },
  maintenance: { text: "text-muted-foreground", dot: "bg-input" },
  none: { text: "text-muted-foreground", dot: "" },
};

export function StatusLine({
  kind,
  children,
  className,
  ...props
}: ComponentProps<"span"> & { kind: StatusLineKind }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 text-sm tabular-nums",
        styles[kind].text,
        className,
      )}
      {...props}
    >
      {kind !== "none" && (
        <span
          aria-hidden="true"
          data-slot="status-dot"
          className={cn("size-2 shrink-0 rounded-full", styles[kind].dot)}
        />
      )}
      <span>{children}</span>
    </span>
  );
}
