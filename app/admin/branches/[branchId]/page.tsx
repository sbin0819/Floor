import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireOperatorPage } from "@/lib/auth/session";
import { ActionError } from "@/lib/actions/result";
import { getAdminBranch } from "@/features/admin/queries";
import { BranchDetail } from "@/features/admin/components/branch-detail";
import { AdminBranchSkeleton } from "@/features/admin/components/admin-skeletons";

type Props = { params: Promise<{ branchId: string }> };
async function BranchContent({ params }: Props) {
  await requireOperatorPage();
  const { branchId } = await params;
  const data = await getAdminBranch(branchId).catch((error: unknown) => {
    if (error instanceof ActionError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  return <BranchDetail data={data} />;
}
export default function AdminBranchPage(props: Props) {
  return (
    <Suspense fallback={<AdminBranchSkeleton />}>
      <BranchContent {...props} />
    </Suspense>
  );
}
