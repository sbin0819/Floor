import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "cn";

export function SkeletonHeading({ compact = false }: { compact?: boolean }) {
  return (
    <div data-slot="skeleton-heading" className="space-y-3">
      <Skeleton className={compact ? "h-6 w-32" : "h-8 w-52 max-w-full"} />
      <Skeleton className="h-4 w-72 max-w-full" />
    </div>
  );
}

export function SkeletonFields({
  count = 2,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-4", className)}>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} data-slot="skeleton-field" className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-11 w-full" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonRows({
  count = 3,
  action = false,
  photo = false,
}: {
  count?: number;
  action?: boolean;
  photo?: boolean;
}) {
  return (
    <div className="divide-y divide-border rounded-xl border border-border bg-card">
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          data-slot="skeleton-row"
          className="flex min-h-24 items-center justify-between gap-4 p-5"
        >
          {photo && (
            <Skeleton
              data-slot="skeleton-photo"
              className="h-12 w-16 shrink-0 rounded-lg"
            />
          )}
          <div className="min-w-0 flex-1 space-y-3">
            <Skeleton className="h-5 w-40 max-w-full" />
            <Skeleton className="h-4 w-64 max-w-full" />
          </div>
          {action && <Skeleton className="h-11 w-24 shrink-0" />}
        </div>
      ))}
    </div>
  );
}
