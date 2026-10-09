import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { requireOperatorPage } from "@/lib/auth/session";
import { ActionError } from "@/lib/actions/result";
import { getAdminShell } from "@/features/admin/admin-shell-queries";
import { adminMenuHref } from "@/features/admin/admin-shell-navigation";
import { AdminForbidden } from "@/features/admin/components/admin-forbidden";
import { getAdminDashboard } from "@/features/admin/queries";
import {
  AdminDashboard,
  AdminDashboardSkeleton,
} from "@/features/admin/components/admin-dashboard";

type Props = {
  params: Promise<{ branchId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};
async function DashboardEntry({ params, searchParams }: Props) {
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
  const search = (await searchParams) ?? {};
  const data = await getAdminDashboard({
    branchId,
    date: search.date,
    range: search.range,
    floorId: typeof search.floor === "string" ? search.floor : null,
  }).catch((error: unknown) => {
    if (error instanceof ActionError && error.code === "NOT_FOUND") notFound();
    if (error instanceof ActionError && error.code === "FORBIDDEN") return null;
    throw error;
  });
  return data ? <AdminDashboard data={data} /> : <AdminForbidden />;
}
export default function AdminDashboardPage(props: Props) {
  return (
    <Suspense fallback={<AdminDashboardSkeleton />}>
      <DashboardEntry {...props} />
    </Suspense>
  );
}
