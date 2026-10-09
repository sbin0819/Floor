import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireOperatorPage } from "@/lib/auth/session";
import { ActionError } from "@/lib/actions/result";
import {
  getMaintenanceList,
  previewMaintenance,
} from "@/features/admin/queries";
import { maintenanceListSchema } from "@/features/admin/maintenance-schema";
import {
  maintenancePreviewRequest,
  maintenanceRoute,
  type MaintenanceSearch,
  type MaintenanceRequest,
} from "@/features/admin/maintenance-navigation";
import {
  AdminMaintenance,
  AdminMaintenanceFrame,
  AdminMaintenanceSkeleton,
} from "@/features/admin/components/admin-maintenance";
import { MaintenanceDialog } from "@/features/admin/components/maintenance-dialog";
import {
  MaintenancePreview,
  type MaintenancePreviewResult,
} from "@/features/admin/components/maintenance-preview";
import { AdminForbidden } from "@/features/admin/components/admin-forbidden";

type Props = {
  params: Promise<{ branchId: string }>;
  searchParams: Promise<MaintenanceSearch>;
};
async function MaintenancePreviewContent({
  preview,
  request,
  timezone,
}: {
  preview: ReturnType<typeof previewMaintenance>;
  request: MaintenanceRequest;
  timezone: string;
}) {
  const result: MaintenancePreviewResult = await preview.then(
    (data) => ({ ok: true as const, data }),
    (error: unknown) => {
      if (!(error instanceof ActionError)) throw error;
      if (error.code === "INVALID_INPUT")
        return {
          ok: false as const,
          message:
            Object.values(error.details.fieldErrors ?? {}).flat()[0] ??
            "공간과 시간을 다시 확인해 주세요",
        };
      if (error.code === "NOT_FOUND" || error.code === "FORBIDDEN")
        return {
          ok: false as const,
          message:
            "이 공간을 관리할 수 없어요. 공간과 권한을 다시 확인해 주세요",
        };
      throw error;
    },
  );
  return (
    <MaintenancePreview
      requestKey={`${request.inputKey}:${request.nonce}`}
      result={result}
      timezone={timezone}
    />
  );
}
async function MaintenanceContent({ params, searchParams }: Props) {
  await requireOperatorPage();
  const [{ branchId }, search] = await Promise.all([params, searchParams]);
  const route = maintenanceRoute(search);
  const parsed = maintenanceListSchema.safeParse({ branchId, tab: route.tab });
  if (!parsed.success)
    return (
      <AdminMaintenanceFrame>
        <p role="alert">지점과 보기 조건을 확인해 주세요</p>
      </AdminMaintenanceFrame>
    );
  const data = await getMaintenanceList(parsed.data).catch((error: unknown) => {
    if (error instanceof ActionError && error.code === "NOT_FOUND") notFound();
    if (error instanceof ActionError && error.code === "FORBIDDEN") return null;
    throw error;
  });
  if (!data) return <AdminForbidden />;
  const row =
    route.dialog === "create"
      ? undefined
      : data.rows.find((value) => value.id === route.blockId);
  const validDialog =
    route.dialog === "create" ||
    (route.dialog === "end"
      ? row?.state === "ongoing"
      : row?.state === "upcoming");
  const candidate = maintenancePreviewRequest(search);
  const request =
    candidate &&
    data.spaces.some((space) => space.id === candidate.input.spaceId) &&
    (route.dialog === "create" || candidate.input.spaceId === row?.space.id)
      ? candidate
      : null;
  return (
    <AdminMaintenance data={data}>
      {route.dialog && validDialog && (
        <MaintenanceDialog
          key={`${branchId}:${route.dialog}:${row?.id ?? "new"}`}
          data={data}
          kind={route.dialog}
          row={row}
          initialRequest={request}
        >
          {(route.dialog === "create" || route.dialog === "edit") &&
            request && (
              <Suspense
                key={`${request.inputKey}:${request.nonce}`}
                fallback={null}
              >
                <MaintenancePreviewContent
                  preview={previewMaintenance(request.input)}
                  request={request}
                  timezone={data.branch.timezone}
                />
              </Suspense>
            )}
        </MaintenanceDialog>
      )}
      {route.dialog && !validDialog && (
        <p role="status">이미 처리됐거나 이 점검을 바꿀 수 없어요</p>
      )}
    </AdminMaintenance>
  );
}
export default function AdminMaintenancePage(props: Props) {
  return (
    <Suspense fallback={<AdminMaintenanceSkeleton />}>
      <MaintenanceContent {...props} />
    </Suspense>
  );
}
