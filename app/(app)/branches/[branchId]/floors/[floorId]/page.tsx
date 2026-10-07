import { Suspense } from "react";
import { notFound } from "next/navigation";
import { ActionError } from "@/lib/actions/result";
import { requirePageSession } from "@/lib/auth/session";
import { getFloorDay, getSpaceDay } from "@/features/bookings/queries";
import {
  floorSelectionKey,
  requestedSpaceId,
} from "@/features/bookings/floor-selection";
import { FloorDay } from "@/features/bookings/components/floor-day";
import { SpaceDetail } from "@/features/bookings/components/space-detail";
import { ResolvedSpaceSelection } from "@/features/bookings/components/branch-workspace";
import {
  EmptySpaceSelection,
  FloorListRegion,
  FloorDetailRegion,
} from "@/features/bookings/components/floor-regions";
import {
  FloorPageSkeleton,
  FloorSpaceListSkeleton,
  SpaceDetailSkeleton,
} from "@/features/bookings/components/booking-skeletons";
import { PageContainer } from "@/components/page-container";

type Props = {
  params: Promise<{ branchId: string; floorId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};
type RegionProps = { branchId: string; floorId: string; date: unknown };
async function FloorListContent({ branchId, floorId, date }: RegionProps) {
  const data = await getFloorDay(branchId, floorId, date).catch(
    (error: unknown) => {
      if (error instanceof ActionError && error.code === "NOT_FOUND")
        notFound();
      throw error;
    },
  );
  return <FloorDay data={data} />;
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
      spaceId={detail?.space.id ?? null}
    >
      {detail ? <SpaceDetail data={detail} /> : <EmptySpaceSelection />}
    </ResolvedSpaceSelection>
  );
}
async function FloorContent({ params, searchParams }: Props) {
  const { branchId, floorId } = await params;
  await requirePageSession(`/branches/${branchId}/floors/${floorId}`);
  const query = await searchParams;
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
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,25rem)]">
        <FloorListRegion>
          <Suspense
            key={`${floorId}:${dateKey}`}
            fallback={<FloorSpaceListSkeleton />}
          >
            <FloorListContent
              branchId={branchId}
              floorId={floorId}
              date={query.date}
            />
          </Suspense>
        </FloorListRegion>
        <FloorDetailRegion>
          <Suspense
            key={`${floorId}:${spaceId}:${dateKey}`}
            fallback={
              spaceId ? <SpaceDetailSkeleton /> : <EmptySpaceSelection />
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
        </FloorDetailRegion>
      </div>
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
