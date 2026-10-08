import { Suspense } from "react";
import { requirePageSession } from "@/lib/auth/session";
import { getFriendsView } from "@/features/people/queries";
import { friendsTab } from "@/features/people/schema";
import { FriendsScreen } from "@/features/people/components/friends-screen";
import {
  PeopleShell,
  PeopleSkeleton,
} from "@/features/people/components/people-shell";

type Props = { searchParams: Promise<{ tab?: string | string[] }> };
async function FriendsContent({ searchParams }: Props) {
  const tab = friendsTab((await searchParams).tab);
  await requirePageSession(tab === "all" ? "/friends" : `/friends?tab=${tab}`);
  return <FriendsScreen data={await getFriendsView(tab)} tab={tab} />;
}
export default function FriendsPage(props: Props) {
  return (
    <PeopleShell title="친구">
      <Suspense fallback={<PeopleSkeleton />}>
        <FriendsContent {...props} />
      </Suspense>
    </PeopleShell>
  );
}
