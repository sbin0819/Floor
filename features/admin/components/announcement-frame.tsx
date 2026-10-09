import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import type { AnnouncementsData } from "../announcement-types";

export function AnnouncementFrame({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto max-w-7xl space-y-6 p-4 lg:p-8">
      <header className="sticky top-[var(--admin-mobile-header-height,0px)] z-30 bg-background py-2">
        <h1 className="text-2xl font-bold">공지</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          라운지와 예약한 사람들에게 소식을 전해요
        </p>
      </header>
      {children}
    </main>
  );
}
export function AnnouncementColumns({
  form,
  history,
}: {
  form: ReactNode;
  history: ReactNode;
}) {
  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
      <section
        aria-labelledby="announcement-compose-title"
        className="min-w-0 rounded-xl border bg-card p-4 shadow-sm sm:p-6"
      >
        <h2 id="announcement-compose-title" className="mb-6 text-lg font-bold">
          공지 보내기
        </h2>
        {form}
      </section>
      <section
        aria-labelledby="announcement-history-title"
        className="min-w-0 rounded-xl border bg-card p-4 shadow-sm sm:p-6"
      >
        <h2 id="announcement-history-title" className="mb-4 text-lg font-bold">
          보낸 공지
        </h2>
        {history}
      </section>
    </div>
  );
}
export function AnnouncementSkeleton() {
  return (
    <AnnouncementColumns
      form={
        <div aria-busy="true" className="space-y-5">
          <span role="status" className="sr-only">
            공지 설정을 불러오고 있어요
          </span>
          <p className="text-sm font-semibold">받는 곳</p>
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-28 w-full" />
          <p className="text-sm font-semibold">제목</p>
          <Skeleton className="h-11 w-full" />
          <p className="text-sm font-semibold">내용</p>
          <Skeleton className="h-40 w-full" />
        </div>
      }
      history={
        <div aria-busy="true" className="space-y-4">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      }
    />
  );
}
export function AnnouncementHistory({ data }: { data: AnnouncementsData }) {
  const format = new Intl.DateTimeFormat("ko-KR", {
    timeZone: data.branch.timezone,
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  if (!data.rows.length)
    return (
      <p className="py-8 text-sm text-muted-foreground">
        최근 30일 동안 보낸 공지가 없어요
      </p>
    );
  return (
    <ul className="divide-y" aria-label="최근 30일 보낸 공지">
      {data.rows.map((row) => (
        <li key={row.id} className="space-y-2 py-4 first:pt-0">
          <p className="text-sm font-semibold wrap-anywhere">{row.title}</p>
          <p className="text-xs leading-6 text-muted-foreground">
            <time dateTime={row.createdAt} className="tabular-nums">
              {format.format(new Date(row.createdAt))}
            </time>
            <span>
              {" "}
              ·{" "}
              {[
                row.lounge ? "라운지 #공지" : null,
                row.audience ? `알림 ${row.recipientCount}명` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </p>
        </li>
      ))}
    </ul>
  );
}
