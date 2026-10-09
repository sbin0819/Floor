import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { requireOperatorPage } from "@/lib/auth/session";
import { ActionError } from "@/lib/actions/result";
import { getAdminShell } from "@/features/admin/admin-shell-queries";
import { adminMenuHref } from "@/features/admin/admin-shell-navigation";
import { AdminForbidden } from "@/features/admin/components/admin-forbidden";
import { SkeletonRegion } from "@/components/skeleton-region";
import { Skeleton } from "@/components/ui/skeleton";

type Props = { params: Promise<{ branchId: string }> };
async function DashboardEntry({ params }: Props) {
  await requireOperatorPage();
  const { branchId } = await params;
  const shell = await getAdminShell(branchId).catch((error: unknown) => {
    if (error instanceof ActionError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const branch = shell.branches.find((row) => row.id === shell.branchId)!;
  if (!branch.menus.includes("dashboard")) {
    const first = branch.menus[0];
    if (first) redirect(adminMenuHref(branch.id, first));
    return <AdminForbidden />;
  }
  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6 lg:p-8">
      <h1 className="text-2xl font-semibold">대시보드</h1>
      <p className="text-muted-foreground">{branch.name}</p>
    </main>
  );
}
export default function AdminDashboardPage(props: Props) {
  return (
    <Suspense
      fallback={
        <main className="mx-auto max-w-6xl space-y-6 p-6 lg:p-8">
          <h1 className="text-2xl font-semibold">대시보드</h1>
          <SkeletonRegion>
            <Skeleton className="h-48 w-full" />
          </SkeletonRegion>
        </main>
      }
    >
      <DashboardEntry {...props} />
    </Suspense>
  );
}
