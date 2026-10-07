import Link from "next/link";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { ActionError } from "@/lib/actions/result";
import { requirePageSession } from "@/lib/auth/session";
import { getBranchFloors } from "@/features/bookings/queries";
import { floorHref } from "@/features/bookings/format";
import { Button } from "@/components/ui/button";

type Props = { params: Promise<{ branchId: string }> };
async function BranchContent({ params }: Props) {
  const { branchId } = await params;
  await requirePageSession(`/branches/${branchId}`);
  const data = await getBranchFloors(branchId).catch((error: unknown) => {
    if (error instanceof ActionError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  if (data.floors[0]) redirect(floorHref(data.branch.id, data.floors[0].id));
  return (
    <main className="mx-auto max-w-5xl space-y-6 px-6 py-8">
      <h1 className="text-2xl font-semibold">{data.branch.name}</h1>
      <p>이 지점에는 이용할 수 있는 층이 아직 없어요</p>
      <Button asChild variant="outline">
        <Link href="/branches">다른 지점 고르기</Link>
      </Button>
    </main>
  );
}
export default function BranchPage(props: Props) {
  return (
    <Suspense
      fallback={
        <p role="status" className="p-6 text-muted-foreground">
          층을 불러오고 있어요.
        </p>
      }
    >
      <BranchContent {...props} />
    </Suspense>
  );
}
