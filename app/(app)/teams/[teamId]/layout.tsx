import { Suspense, type ReactNode } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { getTeamPageData } from "@/features/teams/queries";
import { TeamHeader } from "@/features/teams/components/team-header";
import { TeamTabs } from "@/features/teams/components/team-tabs";
import { PageContainer } from "@/components/page-container";
import { SkeletonRegion } from "@/components/skeleton-region";
import { Skeleton } from "@/components/ui/skeleton";

function TeamHeaderFallback() {
  return (
    <div className="space-y-5">
      <Link href="/teams" className="inline-flex min-h-11 items-center text-sm">
        ‹ 팀 관리
      </Link>
      <SkeletonRegion className="flex gap-4">
        <Skeleton className="size-14" />
        <div className="space-y-2">
          <Skeleton className="h-7 w-44" />
          <Skeleton className="h-4 w-60" />
        </div>
      </SkeletonRegion>
      <div className="flex min-h-11 gap-6 border-b text-sm">
        <span>팀원</span>
        <span>팀 예약</span>
      </div>
    </div>
  );
}
async function TeamLayoutContent({
  params,
  children,
}: {
  params: Promise<{ teamId: string }>;
  children: ReactNode;
}) {
  if (!(await getSession()))
    return (
      <>
        <TeamHeaderFallback />
        {children}
      </>
    );
  const { teamId } = await params;
  const data = await getTeamPageData(teamId);
  if (!data) notFound();
  return (
    <>
      <TeamHeader
        data={{
          id: data.id,
          name: data.name,
          role: data.role,
          memberCount: data.memberCount,
          homeBranchName: data.homeBranchName,
          space: data.space,
          ...(data.role === "admin" ? { canSendEmail: data.canSendEmail } : {}),
        }}
      />
      <TeamTabs
        teamId={data.id}
        role={data.role}
        memberCount={data.memberCount}
        bookingCount={data.upcomingBookingCount}
        requestCount={data.role === "admin" ? data.pendingJoinRequestCount : 0}
      >
        {children}
      </TeamTabs>
    </>
  );
}
export default function TeamLayout(props: {
  params: Promise<{ teamId: string }>;
  children: ReactNode;
}) {
  return (
    <PageContainer as="main" className="space-y-6">
      <Suspense
        fallback={
          <>
            <TeamHeaderFallback />
            {props.children}
          </>
        }
      >
        <TeamLayoutContent {...props} />
      </Suspense>
    </PageContainer>
  );
}
