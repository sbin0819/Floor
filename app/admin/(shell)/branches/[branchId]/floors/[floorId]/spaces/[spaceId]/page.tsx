import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireOperatorPage } from "@/lib/auth/session";
import { ActionError } from "@/lib/actions/result";
import { getAdminSpace } from "@/features/admin/queries";
import { AdminForbidden } from "@/features/admin/components/admin-forbidden";
import { SpaceDetail } from "@/features/admin/components/space-detail";
import {
  SpaceDetailFrame,
  SpaceDetailSkeleton,
} from "@/features/admin/components/space-detail-frame";
import { spaceDetailTab } from "@/features/admin/space-detail-navigation";
type Props = {
  params: Promise<{ branchId: string; floorId: string; spaceId: string }>;
  searchParams: Promise<{ tab?: string | string[]; team?: string | string[] }>;
};
async function Content({ params, searchParams }: Props) {
  await requireOperatorPage();
  const { branchId, floorId, spaceId } = await params;
  const search = await searchParams,
    tab = spaceDetailTab(search.tab);
  const data = await getAdminSpace(branchId, floorId, spaceId, {
    tab,
    team: search.team,
  }).catch((error: unknown) => {
    if (error instanceof ActionError && error.code === "NOT_FOUND") notFound();
    if (error instanceof ActionError && error.code === "FORBIDDEN") return null;
    throw error;
  });
  return data ? (
    <SpaceDetail key={spaceId} data={data} tab={tab} />
  ) : (
    <AdminForbidden />
  );
}
export default function AdminSpacePage(props: Props) {
  return (
    <SpaceDetailFrame>
      <Suspense fallback={<SpaceDetailSkeleton />}>
        <Content {...props} />
      </Suspense>
    </SpaceDetailFrame>
  );
}
