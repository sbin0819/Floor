import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireOperatorPage } from "@/lib/auth/session";
import { ActionError } from "@/lib/actions/result";
import { getAdminFloor } from "@/features/admin/queries";
import { FloorDetail } from "@/features/admin/components/floor-detail";

type Props = {
  params: Promise<{ branchId: string; floorId: string }>;
  searchParams: Promise<{ team?: string | string[] }>;
};
async function FloorContent({ params, searchParams }: Props) {
  await requireOperatorPage();
  const { branchId, floorId } = await params;
  const { team } = await searchParams;
  const data = await getAdminFloor(branchId, floorId, team).catch(
    (error: unknown) => {
      if (error instanceof ActionError && error.code === "NOT_FOUND")
        notFound();
      throw error;
    },
  );
  return <FloorDetail data={data} />;
}
export default function AdminFloorPage(props: Props) {
  return (
    <Suspense
      fallback={
        <p role="status" className="p-6 text-muted-foreground">
          층 정보를 불러오고 있어요
        </p>
      }
    >
      <FloorContent {...props} />
    </Suspense>
  );
}
