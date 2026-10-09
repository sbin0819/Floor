import { useContext, useLayoutEffect, useMemo, useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  AdminMaintenance,
  AdminMaintenanceSkeleton,
} from "@/features/admin/components/admin-maintenance";
import {
  MaintenanceDialog,
  staleMaintenanceMessage,
} from "@/features/admin/components/maintenance-dialog";
import {
  MaintenancePreview,
  MaintenancePreviewContext,
} from "@/features/admin/components/maintenance-preview";
import { AdminShellFrame } from "@/features/admin/components/admin-shell-frame";
import { AdminShellNavigation } from "@/features/admin/components/admin-shell-navigation";
import type { AdminShellData } from "@/features/admin/admin-shell-types";
import { maintenancePath } from "@/features/admin/maintenance-navigation";
import {
  maintenanceBranchId,
  maintenanceFixture,
  maintenancePreviewFixture,
  maintenanceRequest,
} from "@/tests/helpers/maintenance";

const shell: AdminShellData = {
  branchId: maintenanceBranchId,
  branches: [
    {
      id: maintenanceBranchId,
      name: "강남점",
      menus: ["dashboard", "bookings", "spaces", "maintenance"],
      maintenanceCount: 1,
    },
  ],
  user: { name: "김도윤" },
};
function FakePreview({ count, stale }: { count: number; stale: boolean }) {
  const context = useContext(MaintenancePreviewContext);
  const result = useMemo(
    () => ({ ok: true as const, data: maintenancePreviewFixture(count) }),
    [count],
  );
  if (!context?.key) return null;
  return (
    <>
      {stale && (
        <p role="alert" className="text-sm text-destructive">
          {staleMaintenanceMessage}
        </p>
      )}
      <MaintenancePreview
        requestKey={context.key}
        result={result}
        timezone="Asia/Seoul"
      />
    </>
  );
}
function MaintenanceStory({
  mode = "list",
}: {
  mode?: "list" | "empty" | "overlap" | "stale" | "loading";
}) {
  const [client] = useState(() => new QueryClient());
  const dialog = mode !== "list" && mode !== "loading";
  useLayoutEffect(() => {
    // 가상 주소만 바꾸어 실제 경로 이탈 보호도 그대로 동작하게 해요.
    const previous = window.location.href;
    const search = new URLSearchParams(window.location.search);
    if (dialog) search.set("dialog", "create");
    window.history.replaceState(
      window.history.state,
      "",
      `${maintenancePath(maintenanceBranchId)}?${search}`,
    );
    return () => {
      window.history.replaceState(window.history.state, "", previous);
    };
  }, [dialog]);
  return (
    <QueryClientProvider client={client}>
      {mode === "loading" ? (
        <AdminMaintenanceSkeleton />
      ) : (
        <AdminMaintenance data={maintenanceFixture()}>
          {dialog && (
            <MaintenanceDialog
              data={maintenanceFixture()}
              kind="create"
              initialRequest={maintenanceRequest()}
            >
              <FakePreview
                count={mode === "empty" ? 0 : 3}
                stale={mode === "stale"}
              />
            </MaintenanceDialog>
          )}
        </AdminMaintenance>
      )}
    </QueryClientProvider>
  );
}
const meta = {
  title: "운영자/Maintenance",
  component: MaintenanceStory,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    nextjs: {
      appDirectory: true,
      navigation: { pathname: maintenancePath(maintenanceBranchId) },
    },
    docs: {
      description: {
        component:
          "고정된 가상 자료로 RSC 미리보기 완료 상태를 재현해요. 실제 API·DB를 읽거나 점검을 등록하지 않아요. STALE 예시는 같은 초안을 유지한 채 새 미리보기를 확인한 상태예요.",
      },
    },
  },
  decorators: [
    (Story) => (
      <AdminShellFrame
        sidebar={<AdminShellNavigation data={shell} />}
        mobile={<AdminShellNavigation data={shell} mobile />}
      >
        <Story />
      </AdminShellFrame>
    ),
  ],
} satisfies Meta<typeof MaintenanceStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const List: Story = {};
export const NoConflicts: Story = { args: { mode: "empty" } };
export const WithConflicts: Story = { args: { mode: "overlap" } };
export const Stale: Story = { args: { mode: "stale" } };
export const Loading: Story = { args: { mode: "loading" } };
