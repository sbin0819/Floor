import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { NotificationBell } from "@/features/notifications/components/notification-bell";
import type { NotificationSummary } from "@/features/notifications/types";

const summary: NotificationSummary = {
  now: "2026-10-08T05:55:00Z",
  nextAt: null,
  unreadCount: 3,
  items: [
    {
      id: "invited",
      type: "booking_invited",
      read: false,
      scheduledFor: "2026-10-08T05:50:00Z",
      bookingId: "booking",
      href: "/bookings?view=calendar",
      data: {
        actorName: "박지훈",
        spaceName: "회의실 C",
        floorName: "7F",
        branchName: "강남점",
        timezone: "Asia/Seoul",
        start: "2026-10-08T06:00:00Z",
        end: "2026-10-08T07:00:00Z",
        title: "주간 회의",
      },
    },
  ],
};
const meta = {
  title: "컴포넌트/NotificationBell",
  component: NotificationBell,
  tags: ["autodocs"],
  parameters: { nextjs: { appDirectory: true } },
  args: { initialData: summary },
  render: function Example(args) {
    const [client] = useState(() => new QueryClient());
    return (
      <QueryClientProvider client={client}>
        <div className="flex min-h-96 w-[480px] max-w-full justify-end bg-background p-8">
          <NotificationBell
            {...args}
            fetchSummary={async () => args.initialData}
          />
        </div>
      </QueryClientProvider>
    );
  },
} satisfies Meta<typeof NotificationBell>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Empty: Story = {
  args: { initialData: { ...summary, unreadCount: 0, items: [] } },
};
export const ThreeUnread: Story = {};
export const TwelveUnread: Story = {
  args: { initialData: { ...summary, unreadCount: 12 } },
};
