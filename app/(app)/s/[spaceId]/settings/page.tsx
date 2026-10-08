import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requirePageSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getSpaceSettings,
  type SpaceSettings,
} from "@/features/chat/space-settings-queries";
import { getSpaceMembers } from "@/features/chat/space-members-queries";
import {
  getInviteCandidates,
  getSpaceInvites,
} from "@/features/chat/space-invite-queries";
import { spaceSettingsTabs } from "@/features/chat/space-settings";
import { SpaceAccessBoundary } from "@/features/chat/components/space-access-boundary";
import {
  SpaceSettingsTabs,
  SpaceOverview,
  SpaceDanger,
} from "@/features/chat/components/space-settings";
import { SpaceMembers } from "@/features/chat/components/space-members";
import { SpaceInvitesList } from "@/features/chat/components/space-invites-list";
import { SpaceInviteDialog } from "@/features/chat/components/space-invite-dialog";
import { ChannelDialog } from "@/features/chat/components/channel-dialog";

type Props = {
  params: Promise<{ spaceId: string }>;
  searchParams: Promise<{ tab?: string; invite?: string; channel?: string }>;
};
function SettingsSkeleton() {
  return (
    <div
      role="status"
      aria-label="설정을 불러오고 있어요"
      className="space-y-4"
    >
      <Skeleton className="h-11 w-64" />
      <Skeleton className="h-56 w-full" />
    </div>
  );
}
async function SettingsTab({
  space,
  tab,
  currentUserId,
}: {
  space: SpaceSettings;
  tab: string;
  currentUserId: string;
}) {
  if (tab === "members" || tab === "banned") {
    const data = await getSpaceMembers(space.id);
    if (!data) notFound();
    return (
      <SpaceMembers
        data={data}
        currentUserId={currentUserId}
        banned={tab === "banned"}
      />
    );
  }
  if (tab === "invites")
    return <SpaceInvitesList rows={await getSpaceInvites(space.id)} />;
  if (tab === "danger") return <SpaceDanger space={space} />;
  return <SpaceOverview space={space} />;
}
async function SettingsContent({ params, searchParams }: Props) {
  const [{ spaceId }, query] = await Promise.all([params, searchParams]);
  const session = await requirePageSession(
    `/s/${encodeURIComponent(spaceId)}/settings`,
  );
  const space = await getSpaceSettings(spaceId);
  if (!space) notFound();
  const tab =
    spaceSettingsTabs(space).find(({ key }) => key === query.tab)?.key ??
    "overview";
  const returnHref = `/s/${space.id}/settings?tab=${tab}`;
  const invite = space.kind === "community" && query.invite === "1";
  const channel =
    space.role !== "member"
      ? space.channels.find(({ id }) => id === query.channel)
      : undefined;
  return (
    <SpaceAccessBoundary spaceId={space.id}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-lg font-semibold">{space.name}</p>
          {space.kind === "community" && (
            <Button asChild variant="outline">
              <Link href={`${returnHref}&invite=1`} prefetch={false}>
                사람 초대
              </Link>
            </Button>
          )}
        </div>
        <SpaceSettingsTabs space={space} selected={tab} />
        <Suspense key={`${space.id}:${tab}`} fallback={<SettingsSkeleton />}>
          <SettingsTab space={space} tab={tab} currentUserId={session.userId} />
        </Suspense>
        {invite && (
          <SpaceInviteDialog
            key={`${space.id}:invite`}
            spaceId={space.id}
            spaceName={space.name}
            candidates={getInviteCandidates(space.id)}
            returnHref={returnHref}
          />
        )}
        {channel && (
          <ChannelDialog
            key={channel.id}
            spaceId={space.id}
            channel={channel}
            returnHref={returnHref}
          />
        )}
      </div>
    </SpaceAccessBoundary>
  );
}
export default function SpaceSettingsPage(props: Props) {
  return (
    <section className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6">
      <h1 className="text-2xl font-bold">스페이스 설정</h1>
      <p className="text-muted-foreground">함께 쓰는 채널과 사람을 관리해요</p>
      <Suspense fallback={<SettingsSkeleton />}>
        <SettingsContent {...props} />
      </Suspense>
    </section>
  );
}
