import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  AdminBookings,
  AdminBookingsSkeleton,
} from "@/features/admin/components/admin-bookings";
import { OperatorCancelDialog } from "@/features/admin/components/operator-cancel-dialog";
import { AdminShellFrame } from "@/features/admin/components/admin-shell-frame";
import { AdminShellNavigation } from "@/features/admin/components/admin-shell-navigation";
import type { AdminShellData } from "@/features/admin/admin-shell-types";
import {
  adminBookingFixture,
  adminBookingsFixture,
  adminBookingBranchId,
} from "@/tests/helpers/admin-bookings";

const shell: AdminShellData = {
  branchId: adminBookingBranchId,
  branches: [
    {
      id: adminBookingBranchId,
      name: "강남점",
      menus: ["dashboard", "bookings", "spaces"],
    },
  ],
  user: { name: "김도윤" },
};

function AdminBookingsStory({
  mode = "list",
}: {
  mode?: "list" | "cancel" | "empty" | "loading";
}) {
  const [client] = useState(() => new QueryClient());
  const [open, setOpen] = useState(mode === "cancel");
  const rows = [
    adminBookingFixture(),
    adminBookingFixture({
      id: "a0000000-0000-4000-8000-000000000002",
      spaceName: "A-12",
      spaceType: "desk",
      areaName: "오픈 데스크",
      deskPart: "pm",
      start: "2026-10-14T04:00:00Z",
      end: "2026-10-14T13:00:00Z",
      bookerName: "이서연",
      teamName: null,
      title: null,
      attendeeCount: null,
      participantCount: 0,
    }),
    adminBookingFixture({
      id: "a0000000-0000-4000-8000-000000000003",
      spaceName: "폰부스 1",
      spaceType: "phone_booth",
      bookerName: "최민준",
      teamName: null,
      attendeeCount: 1,
      participantCount: 0,
      title: "고객 통화",
      status: "cancelled",
      cancelKind: "operator",
      cancelReason: "운영 사정 · 냉방기 점검",
      canCancel: false,
    }),
    adminBookingFixture({
      id: "a0000000-0000-4000-8000-000000000004",
      spaceName: "회의실 D",
      status: "cancelled",
      cancelKind: "maintenance",
      cancelReason: "모니터 교체",
      canCancel: false,
    }),
  ];
  return (
    <QueryClientProvider client={client}>
      {mode === "loading" ? (
        <AdminBookingsSkeleton />
      ) : (
        <AdminBookings
          data={adminBookingsFixture({
            rows: mode === "empty" ? [] : rows,
            total: mode === "empty" ? 0 : rows.length,
            filters: { ...adminBookingsFixture().filters, status: "all" },
          })}
        />
      )}
      {mode === "cancel" && (
        <>
          <Button className="m-4" onClick={() => setOpen(true)}>
            취소 창 열기
          </Button>
          <OperatorCancelDialog
            row={rows[0]!}
            timezone="Asia/Seoul"
            open={open}
            onOpenChange={setOpen}
          />
        </>
      )}
    </QueryClientProvider>
  );
}
const meta = {
  title: "운영자/AdminBookings",
  component: AdminBookingsStory,
  tags: ["autodocs"],
  parameters: {
    nextjs: {
      appDirectory: true,
      navigation: {
        pathname: `/admin/branches/${adminBookingBranchId}/bookings`,
      },
    },
    layout: "fullscreen",
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
} satisfies Meta<typeof AdminBookingsStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Table: Story = {};
export const CancelDialog: Story = { args: { mode: "cancel" } };
export const Empty: Story = { args: { mode: "empty" } };
export const Loading: Story = { args: { mode: "loading" } };
