import { Suspense } from "react";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireOperatorPage } from "@/lib/auth/session";
import { ActionError } from "@/lib/actions/result";
import { getRoleSettingsEditor } from "@/features/admin/queries";
import { AdminRoleSettings } from "@/features/admin/components/admin-role-settings";
import { AdminRoleSettingsSkeleton } from "@/features/admin/components/admin-role-settings-frame";
import { AdminForbidden } from "@/features/admin/components/admin-forbidden";

type Props = {
  params: Promise<{ branchId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};
async function RolesContent({ params, searchParams }: Props) {
  await requireOperatorPage();
  const [{ branchId }, search] = await Promise.all([
    params,
    searchParams ??
      Promise.resolve<Record<string, string | string[] | undefined>>({}),
  ]);
  const parsedReadKey = z.uuid().safeParse(search.reload);
  const data = await getRoleSettingsEditor(branchId).catch((error: unknown) => {
    if (error instanceof ActionError && error.code === "NOT_FOUND") notFound();
    if (error instanceof ActionError && error.code === "FORBIDDEN") return null;
    throw error;
  });
  if (!data) return <AdminForbidden />;
  return (
    <AdminRoleSettings
      key={data.branch.id}
      data={data}
      readKey={parsedReadKey.success ? parsedReadKey.data : null}
    />
  );
}
export default function AdminRolesPage(props: Props) {
  return (
    <Suspense fallback={<AdminRoleSettingsSkeleton />}>
      <RolesContent {...props} />
    </Suspense>
  );
}
