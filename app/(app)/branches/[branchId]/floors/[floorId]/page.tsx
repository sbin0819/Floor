import { Suspense } from "react";
import { notFound } from "next/navigation";
import { ActionError } from "@/lib/actions/result";
import { requirePageSession } from "@/lib/auth/session";
import { localDate } from "@/lib/time/zoned";
import { getFloorDay, getSpaceDay } from "@/features/bookings/queries";
import { FloorDay } from "@/features/bookings/components/floor-day";
import { SpaceDetail } from "@/features/bookings/components/space-detail";

type Props = {
  params: Promise<{ branchId: string; floorId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};
async function FloorContent({ params, searchParams }: Props) {
  const { branchId, floorId } = await params;
  await requirePageSession(`/branches/${branchId}/floors/${floorId}`);
  const query = await searchParams;
  const data = await getFloorDay(branchId, floorId, query.date).catch(
    (error: unknown) => {
      if (error instanceof ActionError && error.code === "NOT_FOUND")
        notFound();
      throw error;
    },
  );
  const selected =
    typeof query.space === "string"
      ? data.spaces.find(
          (space) => space.kind === "accessible" && space.id === query.space,
        )
      : undefined;
  let detail = null;
  if (selected) {
    try {
      detail = await getSpaceDay(selected.id, data.date);
    } catch (error) {
      if (!(error instanceof ActionError && error.code === "NOT_FOUND"))
        throw error;
    }
  }
  return (
    <FloorDay
      data={data}
      today={localDate(new Date(), data.branch.timezone)}
      selectedSpaceId={detail?.space.id}
    >
      {detail ? <SpaceDetail data={detail} /> : undefined}
    </FloorDay>
  );
}
export default function FloorPage(props: Props) {
  return (
    <Suspense
      fallback={
        <p role="status" className="p-6 text-muted-foreground">
          공간을 불러오고 있어요.
        </p>
      }
    >
      <FloorContent {...props} />
    </Suspense>
  );
}
