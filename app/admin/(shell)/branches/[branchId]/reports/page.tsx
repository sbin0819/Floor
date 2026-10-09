import { Suspense } from "react";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireOperatorPage } from "@/lib/auth/session";
import { ActionError } from "@/lib/actions/result";
import { getBranchReports } from "@/features/admin/queries";
import { BranchReports } from "@/features/admin/components/branch-reports";
import {
  ReportsFrame,
  ReportsSkeleton,
} from "@/features/admin/components/reports-frame";
import { AdminForbidden } from "@/features/admin/components/admin-forbidden";
import { reportTab } from "@/features/admin/report-navigation";
type Props = {
  params: Promise<{ branchId: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
};
async function ReportsContent({ params, searchParams }: Props) {
  await requireOperatorPage();
  const [{ branchId }, search] = await Promise.all([params, searchParams]);
  if (!z.uuid().safeParse(branchId).success) notFound();
  const data = await getBranchReports({
    branchId,
    tab: reportTab(search.tab),
  }).catch((error: unknown) => {
    if (error instanceof ActionError && error.code === "NOT_FOUND") notFound();
    if (error instanceof ActionError && error.code === "FORBIDDEN") return null;
    throw error;
  });
  return data ? (
    <BranchReports key={data.branch.id} data={data} />
  ) : (
    <AdminForbidden />
  );
}
export default function ReportsPage(props: Props) {
  return (
    <ReportsFrame>
      <Suspense fallback={<ReportsSkeleton />}>
        <ReportsContent {...props} />
      </Suspense>
    </ReportsFrame>
  );
}
