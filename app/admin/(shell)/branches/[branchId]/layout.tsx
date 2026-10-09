import { Suspense, type ReactNode } from "react";
import { notFound } from "next/navigation";
import { ActionError } from "@/lib/actions/result";
import { getSession } from "@/lib/auth/session";
import { getAdminShell } from "@/features/admin/admin-shell-queries";
import { AdminShellNavigation } from "@/features/admin/components/admin-shell-navigation";
import {
  AdminShellFrame,
  AdminSidebarPending,
  AdminMobilePending,
} from "@/features/admin/components/admin-shell-frame";

type Props = { children: ReactNode; params: Promise<{ branchId: string }> };
async function Navigation({
  params,
  mobile = false,
}: {
  params: Props["params"];
  mobile?: boolean;
}) {
  if (!(await getSession()))
    return mobile ? <AdminMobilePending /> : <AdminSidebarPending />;
  const { branchId } = await params;
  const data = await getAdminShell(branchId).catch((error: unknown) => {
    if (error instanceof ActionError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  return <AdminShellNavigation data={data} mobile={mobile} />;
}
export default function AdminBranchLayout({ params, children }: Props) {
  return (
    <AdminShellFrame
      sidebar={
        <Suspense fallback={<AdminSidebarPending />}>
          <Navigation params={params} />
        </Suspense>
      }
      mobile={
        <Suspense fallback={<AdminMobilePending />}>
          <Navigation params={params} mobile />
        </Suspense>
      }
    >
      {children}
    </AdminShellFrame>
  );
}
