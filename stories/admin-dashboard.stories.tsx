import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import {
  AdminDashboard,
  AdminDashboardSkeleton,
} from "@/features/admin/components/admin-dashboard";
import {
  adminDashboardFixture,
  adminDashboardPlan,
} from "@/tests/helpers/admin-dashboard";
import { AdminShellFrame } from "@/features/admin/components/admin-shell-frame";
import { AdminShellNavigation } from "@/features/admin/components/admin-shell-navigation";
import type { AdminShellData } from "@/features/admin/admin-shell-types";

const data = adminDashboardFixture({ canManageMaintenance: true });
function DashboardProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { mutations: { retry: false } } }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
const shell: AdminShellData = {
  branchId: data.branch.id,
  branches: [
    {
      id: data.branch.id,
      name: data.branch.name,
      menus: ["dashboard", "bookings", "spaces", "maintenance"],
      maintenanceCount: 1,
    },
  ],
  user: { name: "김도윤" },
};
const meta = {
  title: "Admin/Dashboard",
  component: AdminDashboard,
  parameters: {
    layout: "fullscreen",
    nextjs: {
      appDirectory: true,
      navigation: { pathname: `/admin/branches/${data.branch.id}` },
    },
    docs: {
      description: {
        component:
          "고정 시각·가상 조회 결과만 쓰는 운영 대시보드예요. 실제 DB나 예약 쓰기를 실행하지 않아요.",
      },
    },
  },
  decorators: [
    (Story) => (
      <DashboardProvider>
        <AdminShellFrame
          sidebar={<AdminShellNavigation data={shell} />}
          mobile={<AdminShellNavigation data={shell} mobile />}
        >
          <Story />
        </AdminShellFrame>
      </DashboardProvider>
    ),
  ],
  args: { data },
} satisfies Meta<typeof AdminDashboard>;
export default meta;
type Story = StoryObj<typeof meta>;
export const AllFloors: Story = {};
export const SelectedFloor: Story = {
  args: {
    data: { ...data, floorId: data.floors[0]!.id, plan: adminDashboardPlan },
  },
};
export const NoPlan: Story = {
  args: { data: { ...data, floorId: data.floors[0]!.id } },
};
export const Loading: Story = { render: () => <AdminDashboardSkeleton /> };
