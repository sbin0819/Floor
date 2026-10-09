import { useLayoutEffect, useMemo, useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AdminRoleSettings } from "@/features/admin/components/admin-role-settings";
import { AdminRoleSettingsSkeleton } from "@/features/admin/components/admin-role-settings-frame";
import { AdminShellFrame } from "@/features/admin/components/admin-shell-frame";
import { AdminShellNavigation } from "@/features/admin/components/admin-shell-navigation";
import type { AdminShellData } from "@/features/admin/admin-shell-types";
import {
  roleSettingsBranchId,
  roleSettingsFixture,
  roleSettingsPath,
} from "@/tests/helpers/role-settings";

const shell: AdminShellData = {
  branchId: roleSettingsBranchId,
  user: { name: "김도윤" },
  branches: [
    {
      id: roleSettingsBranchId,
      name: "강남점",
      menus: ["dashboard", "bookings", "spaces", "maintenance", "roles"],
    },
    {
      id: "c2000000-0000-4000-8000-000000000002",
      name: "성수점",
      menus: ["dashboard", "roles"],
    },
  ],
};
function RoleSettingsStory({ loading = false }: { loading?: boolean }) {
  const [client] = useState(() => new QueryClient());
  const data = useMemo(() => roleSettingsFixture(), []);
  useLayoutEffect(() => {
    const previous = window.location.href;
    window.history.replaceState(
      window.history.state,
      "",
      `${roleSettingsPath}${window.location.search}`,
    );
    return () =>
      window.history.replaceState(window.history.state, "", previous);
  }, []);
  return (
    <QueryClientProvider client={client}>
      <AdminShellFrame
        sidebar={<AdminShellNavigation data={shell} />}
        mobile={<AdminShellNavigation data={shell} mobile />}
      >
        {loading ? (
          <AdminRoleSettingsSkeleton />
        ) : (
          <AdminRoleSettings data={data} />
        )}
      </AdminShellFrame>
    </QueryClientProvider>
  );
}
function visibleSwitch(canvas: HTMLElement, name: string) {
  return Array.from(
    canvas.querySelectorAll<HTMLElement>('[role="switch"]'),
  ).find(
    (node) =>
      node.getAttribute("aria-label") === name &&
      node.getClientRects().length > 0,
  );
}
const meta = {
  title: "운영자/RoleSettings",
  component: RoleSettingsStory,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    nextjs: { appDirectory: true, navigation: { pathname: roleSettingsPath } },
    docs: {
      description: {
        component:
          "고정된 가상 지점과 기본 권한을 사용해요. 실제 DB/API를 읽거나 역할 설정을 저장하지 않아요. 바꾼 칸·확인 창 예시는 실제 스위치를 눌러 만듭니다.",
      },
    },
  },
} satisfies Meta<typeof RoleSettingsStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Defaults: Story = {};
export const Changed: Story = {
  play: async ({ canvasElement }) => {
    const target = visibleSwitch(canvasElement, "일반 사용자: 개인으로 예약");
    target?.focus();
    target?.click();
  },
};
export const Confirm: Story = {
  play: async ({ canvasElement }) => {
    const target = visibleSwitch(
      canvasElement,
      "일반 사용자: 평면도·공간 보기",
    );
    target?.focus();
    target?.click();
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    const save = Array.from(
      canvasElement.querySelectorAll<HTMLButtonElement>("button"),
    ).find((node) => node.textContent === "저장");
    save?.focus();
    save?.click();
  },
};
export const Loading: Story = { args: { loading: true } };
