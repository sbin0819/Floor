import Link from "next/link";
import { Hash } from "lucide-react";
import type { ReactNode } from "react";
import { PageContainer, PageHeading } from "@/components/page-container";
import { Skeleton } from "@/components/ui/skeleton";
import type { ChatNav, ChatSpaceNav } from "@/features/chat/types";
import { LiveDirectMessages } from "./chat-nav";

export function MessagesShell({ children }: { children: ReactNode }) {
  return (
    <PageContainer as="main" className="space-y-8">
      <PageHeading
        title="메시지"
        description="팀 스페이스의 채널에서 함께 이야기해요"
      />
      <nav aria-label="메시지 메뉴" className="flex gap-4">
        <Link
          href="/friends"
          className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4"
        >
          친구
        </Link>
        <Link
          href="/messages/new"
          className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4"
        >
          새 메시지
        </Link>
      </nav>
      {children}
    </PageContainer>
  );
}

export function MessagesList({ data }: { data: ChatNav }) {
  return (
    <div className="space-y-8">
      <LiveDirectMessages data={data} />
      <SpaceList spaces={data.spaces} />
    </div>
  );
}
function SpaceList({ spaces }: { spaces: ChatSpaceNav[] }) {
  if (spaces.length === 0) {
    return (
      <div className="space-y-3 rounded-xl border bg-card p-5">
        <p>아직 참여한 스페이스가 없어요. 팀에 들어가면 팀 스페이스가 생겨요</p>
        <Link
          href="/teams"
          className="inline-flex min-h-11 items-center rounded-lg font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          팀 관리로 가기
        </Link>
      </div>
    );
  }
  return (
    <div className="space-y-6">
      {spaces.map((space) => (
        <section
          key={space.id}
          aria-label={space.name}
          className="rounded-xl border bg-card p-5 shadow-card"
        >
          <h2 className="mb-3 text-base font-semibold">{space.name}</h2>
          {space.channels.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              아직 열린 채널이 없어요
            </p>
          ) : (
            <ul className="space-y-1">
              {space.channels.map((channel) => (
                <li key={channel.id}>
                  <Link
                    href={`/s/${space.id}/${channel.id}`}
                    className="flex min-h-11 items-center gap-2 rounded-sm px-3 text-sm hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <Hash aria-hidden="true" className="size-5" />
                    {channel.name}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

export function MessagesSkeleton() {
  return (
    <div aria-busy="true" className="space-y-6">
      <span role="status" className="sr-only">
        스페이스와 채널을 불러오고 있어요
      </span>
      {[0, 1].map((item) => (
        <div
          key={item}
          aria-hidden="true"
          className="space-y-3 rounded-xl border bg-card p-5"
        >
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
        </div>
      ))}
    </div>
  );
}
