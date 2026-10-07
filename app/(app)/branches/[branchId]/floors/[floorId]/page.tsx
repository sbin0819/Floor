import { Suspense } from "react";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { ActionError } from "@/lib/actions/result";
import { requirePageSession } from "@/lib/auth/session";
import { getFloorDay, getSpaceDay } from "@/features/bookings/queries";
import {
  floorSelectionKey,
  requestedSpaceId,
} from "@/features/bookings/floor-selection";
import { FloorViews } from "@/features/bookings/components/floor-views";
import { FloorScreenLayout } from "@/features/bookings/components/floor-view";
import {
  resolveFloorView,
  type FloorView,
} from "@/features/bookings/floor-view";
import { SpaceDetail } from "@/features/bookings/components/space-detail";
import { SpaceDetailContainer } from "@/features/bookings/components/space-detail-container";
import { ResolvedSpaceSelection } from "@/features/bookings/components/branch-workspace";
import {
  EmptySpaceSelection,
  FloorListRegion,
  FloorDetailRegion,
} from "@/features/bookings/components/floor-regions";
import { FloorPageSkeleton } from "@/features/bookings/components/booking-skeletons";
import { SpaceDetailLoading } from "@/features/bookings/components/space-detail-loading";
import { PageContainer } from "@/components/page-container";
import { FloorViewsSkeleton } from "@/features/bookings/components/floor-view-skeleton";

type Props = {
  params: Promise<{ branchId: string; floorId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};
type RegionProps = { branchId: string; floorId: string; date: unknown };
async function FloorListContent({
  branchId,
  floorId,
  date,
  initialView,
}: RegionProps & { initialView: FloorView | null }) {
  const data = await getFloorDay(branchId, floorId, date).catch(
    (error: unknown) => {
      if (error instanceof ActionError && error.code === "NOT_FOUND")
        notFound();
      throw error;
    },
  );
  return <FloorViews data={data} initialView={initialView} />;
}
async function FloorDetailContent({
  branchId,
  floorId,
  date,
  spaceId,
  selectionKey,
}: RegionProps & { spaceId: string | null; selectionKey: string }) {
  let detail = null;
  if (spaceId) {
    try {
      detail = await getSpaceDay(branchId, floorId, spaceId, date);
    } catch (error) {
      if (!(error instanceof ActionError && error.code === "NOT_FOUND"))
        throw error;
    }
  }
  return (
    <ResolvedSpaceSelection
      selectionKey={selectionKey}
      spaceId={detail?.openHours ? detail.space.id : null}
    >
      <SpaceDetailContainer closed={detail?.openHours === null}>
        <FloorDetailRegion>
          {detail ? <SpaceDetail data={detail} /> : <EmptySpaceSelection />}
        </FloorDetailRegion>
      </SpaceDetailContainer>
    </ResolvedSpaceSelection>
  );
}
async function FloorContent({ params, searchParams }: Props) {
  const { branchId, floorId } = await params;
  await requirePageSession(`/branches/${branchId}/floors/${floorId}`);
  const query = await searchParams;
  const initialView = resolveFloorView(
    query.view,
    (await cookies()).get("floor_view")?.value,
  );
  const spaceId = requestedSpaceId(query.space);
  const dateKey = JSON.stringify(query.date ?? null);
  const selectionKey = floorSelectionKey(
    branchId,
    floorId,
    query.date,
    query.space,
  );
  return (
    <PageContainer as="main" width="wide" className="pt-0">
      <FloorScreenLayout>
        <FloorListRegion>
          <Suspense
            key={`${floorId}:${dateKey}`}
            fallback={<FloorViewsSkeleton initialView={initialView} />}
          >
            <FloorListContent
              branchId={branchId}
              floorId={floorId}
              date={query.date}
              initialView={initialView}
            />
          </Suspense>
        </FloorListRegion>
        <Suspense
          key={`${floorId}:${spaceId}:${dateKey}`}
          fallback={
            <SpaceDetailContainer>
              {spaceId ? <SpaceDetailLoading /> : <EmptySpaceSelection />}
            </SpaceDetailContainer>
          }
        >
          <FloorDetailContent
            branchId={branchId}
            floorId={floorId}
            date={query.date}
            spaceId={spaceId}
            selectionKey={selectionKey}
          />
        </Suspense>
      </FloorScreenLayout>
    </PageContainer>
  );
}
export default function FloorPage(props: Props) {
  return (
    <Suspense fallback={<FloorPageSkeleton />}>
      <FloorContent {...props} />
    </Suspense>
  );
}
