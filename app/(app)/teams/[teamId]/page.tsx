import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requirePageSession } from "@/lib/auth/session";
import { ActionError } from "@/lib/actions/result";
import {
  getTeamPageData,
  getTeamRemovalPreview,
} from "@/features/teams/queries";
import { TeamDetail } from "@/features/teams/components/team-detail";
import { TeamTabSkeleton } from "@/features/teams/components/team-tab-skeleton";
import { TeamRouteDialog } from "@/features/teams/components/team-route-dialog";
import { TeamRemoval } from "@/features/teams/components/team-removal";
import {
  selectedTeamTab,
  teamHref,
  type TeamSearch,
} from "@/features/teams/navigation";
import { SkeletonRegion } from "@/components/skeleton-region";
import { Skeleton } from "@/components/ui/skeleton";

type TeamPageProps = {
  params: Promise<{ teamId: string }>;
  searchParams?: Promise<TeamSearch>;
};
function previewUnavailable(error: unknown): null {
  if (
    error instanceof ActionError &&
    (error.code === "NOT_FOUND" || error.code === "FORBIDDEN")
  )
    return null;
  throw error;
}
function PreviewSkeleton() {
  return (
    <SkeletonRegion className="space-y-3">
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-11 w-full" />
    </SkeletonRegion>
  );
}
async function RemovalContent({
  preview,
  teamName,
  name,
  leaving,
}: {
  preview: ReturnType<typeof getTeamRemovalPreview>;
  teamName: string;
  name: string;
  leaving: boolean;
}) {
  const value = await preview.catch(previewUnavailable);
  return value ? (
    <TeamRemoval
      preview={value}
      teamName={teamName}
      name={name}
      leaving={leaving}
    />
  ) : (
    <p role="status">이미 처리됐거나 이 작업을 할 수 없어요</p>
  );
}
async function TeamPageContent({ params, searchParams }: TeamPageProps) {
  const [{ teamId }, query] = await Promise.all([
    params,
    searchParams ?? Promise.resolve({} as TeamSearch),
  ]);
  const values = Object.fromEntries(
    Object.entries(query).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  await requirePageSession(teamHref(teamId, values));
  const data = await getTeamPageData(teamId);
  if (!data) notFound();
  const tab = selectedTeamTab(query.tab, data.role);
  const member =
    typeof query.member === "string"
      ? data.members.find((row) => row.id === query.member)
      : null;
  const leaving = query.dialog === "leave" && member?.id === data.userId;
  const removing =
    query.dialog === "remove" &&
    data.role === "admin" &&
    member?.id !== data.userId;
  return (
    <>
      <Suspense key={tab} fallback={<TeamTabSkeleton tab={tab} />}>
        {tab === "bookings" || tab === "settings" ? (
          <TeamTabSkeleton tab={tab} />
        ) : (
          <TeamDetail
            data={data}
            tab={tab === "requests" ? "requests" : "members"}
          />
        )}
      </Suspense>
      {tab === "members" && member && (leaving || removing) && (
        <TeamRouteDialog
          key={`${query.dialog}:${member.id}`}
          teamId={data.id}
          title={
            leaving
              ? `${data.name}에서 나갈까요?`
              : `${member.name} 님을 ${data.name}에서 내보낼까요?`
          }
          description={
            leaving
              ? "다시 들어오려면 초대나 가입 승인이 필요해요."
              : "내보낸 뒤 다시 들이려면 초대를 보내야 해요."
          }
          returnMemberId={member.id}
        >
          <Suspense fallback={<PreviewSkeleton />}>
            <RemovalContent
              preview={getTeamRemovalPreview(data.id, member.id)}
              teamName={data.name}
              name={member.name}
              leaving={leaving}
            />
          </Suspense>
        </TeamRouteDialog>
      )}
    </>
  );
}
export default function TeamPage(props: TeamPageProps) {
  return (
    <Suspense fallback={<TeamTabSkeleton />}>
      <TeamPageContent {...props} />
    </Suspense>
  );
}
