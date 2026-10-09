import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { AdminShellFrame } from "@/features/admin/components/admin-shell-frame";
import { AdminShellNavigation } from "@/features/admin/components/admin-shell-navigation";
import type { AdminShellData } from "@/features/admin/admin-shell-types";

const branchId = "10000000-0000-4000-8000-000000000001";
const data: AdminShellData = {
  branchId,
  branches: [
    {
      id: branchId,
      name: "강남점",
      menus: ["dashboard", "bookings", "spaces"],
    },
    {
      id: "10000000-0000-4000-8000-000000000002",
      name: "성수점",
      menus: ["bookings", "spaces"],
    },
  ],
  user: { name: "김도윤" },
};
function ShellStory({ value }: { value: AdminShellData }) {
  return (
    <AdminShellFrame
      sidebar={<AdminShellNavigation data={value} />}
      mobile={<AdminShellNavigation data={value} mobile />}
    >
      <main className="space-y-4 p-6 lg:p-8">
        <h1 className="text-2xl font-semibold">공간 관리</h1>
        <p className="text-sm text-muted-foreground">
          지점 정보와 층을 관리해요.
        </p>
      </main>
    </AdminShellFrame>
  );
}
const meta = {
  title: "Admin/Shell",
  component: ShellStory,
  parameters: {
    layout: "fullscreen",
    nextjs: {
      appDirectory: true,
      navigation: { pathname: `/admin/branches/${branchId}/spaces` },
    },
  },
  args: { value: data },
} satisfies Meta<typeof ShellStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const MultipleBranches: Story = {};
export const SingleBranch: Story = {
  args: { value: { ...data, branches: [data.branches[0]!] } },
};
export const RestrictedMenus: Story = {
  args: {
    value: { ...data, branches: [{ ...data.branches[0]!, menus: ["spaces"] }] },
  },
};
