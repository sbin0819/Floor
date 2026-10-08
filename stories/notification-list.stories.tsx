import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { NotificationList } from "@/features/notifications/components/notification-list";
import { notificationHref } from "@/features/notifications/format";
import {
  bookingNotificationTypes,
  type NotificationItem,
} from "@/features/notifications/types";

const items: NotificationItem[] = bookingNotificationTypes.map((type, index) => {
  const content = {
    type,
    data: {
      actorName:
        type === "booking_reminder"
          ? undefined
          : ["최민준", "박지훈", "이서연"][index % 3],
      spaceName: "회의실 C",
      floorName: "7F",
      branchName: "강남점",
      timezone: "Asia/Seoul",
      start: "2026-10-08T06:00:00Z",
      end: "2026-10-08T07:00:00Z",
      title: type === "booking_reminder" ? undefined : "주간 회의",
      ...(type === "booking_reminder" ? { minutesBefore: 5 as const } : {}),
      ...(type === "booking_changed"
        ? {
            previousStart: "2026-10-08T05:00:00Z",
            previousEnd: "2026-10-08T06:00:00Z",
          }
        : {}),
    },
  };
  return {
    id: type,
    ...content,
    read: index >= 3,
    scheduledFor: "2026-10-08T05:50:00Z",
    bookingId: "booking",
    href: notificationHref(content),
  };
});

const meta = {
  title: "Notifications/List",
  component: NotificationList,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-[392px] overflow-hidden rounded-xl border border-border bg-card shadow-pop">
        <Story />
      </div>
    ),
  ],
  args: {
    items,
    now: "2026-10-08T05:55:00Z",
    onActivate: (_, event) => event.preventDefault(),
  },
} satisfies Meta<typeof NotificationList>;
export default meta;
type Story = StoryObj<typeof meta>;
export const AllTypes: Story = {};
export const Read: Story = {
  args: { items: items.map((item) => ({ ...item, read: true })) },
};
export const Empty: Story = { args: { items: [] } };
