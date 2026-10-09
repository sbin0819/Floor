import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireOperatorPage } from "@/lib/auth/session";
import { ActionError } from "@/lib/actions/result";
import { getAdminPlans } from "@/features/admin/queries";
import {
  AdminPlans,
  AdminPlansSkeleton,
} from "@/features/admin/components/admin-plans";
import { AdminForbidden } from "@/features/admin/components/admin-forbidden";
async function PlansContent({
  params,
}: {
  params: Promise<{ branchId: string }>;
}) {
  await requireOperatorPage();
  const { branchId } = await params;
  const data = await getAdminPlans(branchId).catch((error: unknown) => {
    if (error instanceof ActionError && error.code === "NOT_FOUND") notFound();
    if (error instanceof ActionError && error.code === "FORBIDDEN") return null;
    throw error;
  });
  return data ? <AdminPlans data={data} /> : <AdminForbidden />;
}
export default function AdminPlansPage(props: {
  params: Promise<{ branchId: string }>;
}) {
  return (
    <Suspense fallback={<AdminPlansSkeleton />}>
      <PlansContent {...props} />
    </Suspense>
  );
}
