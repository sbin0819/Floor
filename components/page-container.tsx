import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "cn";

const widths = {
  wide: "max-w-[1184px]",
  standard: "max-w-[880px]",
  form: "max-w-[640px]",
} as const;

export type PageWidth = keyof typeof widths;

export function PageContainer({
  as: Element = "div",
  width = "standard",
  className,
  ...props
}: HTMLAttributes<HTMLElement> & { as?: "div" | "main"; width?: PageWidth }) {
  return (
    <Element
      className={cn(
        "mx-auto w-full px-4 py-8 md:px-8",
        widths[width],
        className,
      )}
      {...props}
    />
  );
}

export function PageHeading({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-4",
        className,
      )}
    >
      <div className="min-w-0 space-y-1">
        <h1 className="text-[26px] font-bold tracking-[-0.025em]">{title}</h1>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
