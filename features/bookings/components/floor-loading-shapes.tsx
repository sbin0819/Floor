import { Skeleton } from "@/components/ui/skeleton";

export function FloorTimetableShape() {
  return (
    <div
      data-slot="skeleton-timetable"
      aria-hidden="true"
      className="overflow-hidden rounded-xl border border-border bg-card"
    >
      <div className="grid h-12 grid-cols-[148px_1fr] border-b border-border lg:grid-cols-[232px_1fr]">
        <div className="flex items-center px-4">
          <Skeleton className="h-4 w-24" />
        </div>
        <div className="flex items-center gap-12 overflow-hidden px-4">
          {[0, 1, 2, 3, 4].map((key) => (
            <Skeleton key={key} className="h-4 w-12 shrink-0" />
          ))}
        </div>
      </div>
      <div className="flex h-10 items-center border-b border-border bg-muted/40 px-4">
        <Skeleton className="h-4 w-32" />
      </div>
      {[0, 1, 2, 3].map((key) => (
        <div
          key={key}
          data-slot="skeleton-timetable-row"
          className="grid h-16 grid-cols-[148px_1fr] border-b border-border last:border-b-0 lg:grid-cols-[232px_1fr]"
        >
          <div className="flex items-center gap-3 border-r border-border px-4">
            <Skeleton className="hidden h-9 w-12 shrink-0 lg:block" />
            <div className="min-w-0 space-y-2">
              <Skeleton className="h-4 w-24 max-w-full" />
              <Skeleton className="h-3 w-16" />
            </div>
          </div>
          <div className="grid grid-cols-8 divide-x divide-border">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((cell) => (
              <div key={cell} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
