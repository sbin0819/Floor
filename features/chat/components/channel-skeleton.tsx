import { Skeleton } from "@/components/ui/skeleton";

export function ChannelSkeleton() {
  return (
    <section
      data-chat-screen
      aria-label="채널을 불러오는 중이에요"
      aria-busy="true"
      className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col"
    >
      <span role="status" className="sr-only">
        채널을 불러오고 있어요
      </span>
      <div className="flex h-16 shrink-0 items-center gap-3 border-b border-border bg-card px-6">
        <Skeleton className="size-5" />
        <Skeleton className="h-5 w-24" />
        <Skeleton className="ml-auto h-6 w-12" />
      </div>
      <div className="flex-1 space-y-8 overflow-hidden p-6">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="flex gap-3">
            <Skeleton className="size-10 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-5 w-1/2" />
            </div>
          </div>
        ))}
      </div>
      <div className="shrink-0 border-t border-border p-4">
        <Skeleton className="h-16 rounded-xl" />
      </div>
    </section>
  );
}
