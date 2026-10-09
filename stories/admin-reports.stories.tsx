import { useLayoutEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  ReportsFrame,
  ReportsSkeleton,
} from "@/features/admin/components/reports-frame";
import { BranchReports } from "@/features/admin/components/branch-reports";
import { ReportCard } from "@/features/admin/components/report-card";
import { AdminShellFrame } from "@/features/admin/components/admin-shell-frame";
import { AdminShellNavigation } from "@/features/admin/components/admin-shell-navigation";
import { reportsPath } from "@/features/admin/report-navigation";
import type { AdminShellData } from "@/features/admin/admin-shell-types";
import {
  branchReportsFixture,
  reportBranchId,
  reportGroupFixture,
} from "@/tests/helpers/reports";

function ReportsStory({
  mode = "open",
}: {
  mode?: "open" | "resolved" | "deleted" | "empty" | "loading";
}) {
  const [client] = useState(() => new QueryClient());
  useLayoutEffect(() => {
    const previous = window.location.href;
    window.history.replaceState(
      window.history.state,
      "",
      `${reportsPath(reportBranchId)}${window.location.search}`,
    );
    return () =>
      window.history.replaceState(window.history.state, "", previous);
  }, []);
  const data = branchReportsFixture(
    mode === "empty"
      ? { rows: [], reportSummary: { count: 0, oldestAt: null } }
      : mode === "resolved"
        ? {
            tab: "resolved",
            rows: [
              reportGroupFixture({
                resolution: "message_deleted",
                resolvedByName: "김도윤",
                resolvedAt: "2026-10-14T02:30:00.000Z",
                deleted: true,
                body: "",
              }),
            ],
          }
        : mode === "deleted"
          ? { rows: [reportGroupFixture({ deleted: true, body: "" })] }
          : {},
  );
  const shell: AdminShellData = {
    branchId: reportBranchId,
    user: { name: "김도윤" },
    branches: [
      {
        id: reportBranchId,
        name: "강남점",
        menus: [
          "dashboard",
          "bookings",
          "spaces",
          "maintenance",
          "plans",
          "announcements",
          "reports",
          "roles",
        ],
        reportSummary: data.reportSummary,
      },
    ],
  };
  return (
    <QueryClientProvider client={client}>
      <AdminShellFrame
        sidebar={<AdminShellNavigation data={shell} />}
        mobile={<AdminShellNavigation data={shell} mobile />}
      >
        <ReportsFrame>
          {mode === "loading" ? (
            <ReportsSkeleton />
          ) : (
            <BranchReports data={data} />
          )}
        </ReportsFrame>
      </AdminShellFrame>
    </QueryClientProvider>
  );
}
const meta = {
  title: "운영자/Reports",
  component: ReportsStory,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "가상 신고예요. 처리 버튼은 읽기 전용 가짜 액션으로 거절하며 DB나 API를 호출하지 않아요.",
      },
    },
  },
} satisfies Meta<typeof ReportsStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Open: Story = {};
export const Resolved: Story = { args: { mode: "resolved" } };
export const Deleted: Story = { args: { mode: "deleted" } };
export const Empty: Story = { args: { mode: "empty" } };
export const Loading: Story = { args: { mode: "loading" } };
export const LoungeCard: Story = {
  render: () => (
    <div className="p-6">
      <ReportCard
        row={reportGroupFixture()}
        now="2026-10-14T03:00:00Z"
        timezone="Asia/Seoul"
      />
    </div>
  ),
};
export const MeetingCard: Story = {
  render: () => (
    <div className="p-6">
      <ReportCard
        row={branchReportsFixture().rows[1]!}
        now="2026-10-14T03:00:00Z"
        timezone="Asia/Seoul"
      />
    </div>
  ),
};
