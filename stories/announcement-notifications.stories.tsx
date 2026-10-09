import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { NotificationList } from "@/features/notifications/components/notification-list";
import type { NotificationItem } from "@/features/notifications/types";

const item: NotificationItem = {
  id: "announcement-story",
  type: "branch_announcement",
  actorAvatar: null,
  read: false,
  bookingId: null,
  href: null,
  scheduledFor: "2026-10-14T00:12:00Z",
  data: {
    branchName: "강남점",
    title: "7층 정전 점검 안내",
    body: "10월 15일 07:00–08:30 7층 전기 점검이 있어요.\n08:30부터는 평소처럼 이용할 수 있어요. 일찍 오시는 분은 6층 라운지를 이용해 주세요.",
    announcementId: "a1000000-0000-4000-8000-000000000001",
  },
};
function AnnouncementNotifications({
  read = false,
  pending = false,
}: {
  read?: boolean;
  pending?: boolean;
}) {
  const [items, setItems] = useState<NotificationItem[]>(() => [
    { ...item, read },
  ]);
  return (
    <div className="mx-auto w-[392px] max-w-full overflow-hidden rounded-xl border border-border bg-card shadow-pop">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="font-semibold">알림</h2>
        <span className="text-xs text-muted-foreground tabular-nums">
          읽지 않음 {items.filter((value) => !value.read).length}개
        </span>
      </div>
      <NotificationList
        items={items}
        now="2026-10-14T00:17:00Z"
        pendingIds={pending ? new Set([item.id]) : undefined}
        onActivate={(selected, event) => {
          event.preventDefault();
          setItems((values) =>
            values.map((value) =>
              value.id === selected.id ? { ...value, read: true } : value,
            ),
          );
        }}
      />
    </div>
  );
}
const meta = {
  title: "Notifications/Branch announcement",
  component: AnnouncementNotifications,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "가상 공지예요. 펼치기와 읽음 표시는 이 예시의 상태만 바꾸고 서버 액션이나 API를 호출하지 않아요.",
      },
    },
  },
} satisfies Meta<typeof AnnouncementNotifications>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Collapsed: Story = {};
export const Expanded: Story = {
  play: async ({ canvasElement }) => {
    canvasElement
      .querySelector<HTMLButtonElement>('button[aria-expanded="false"]')
      ?.click();
  },
};
export const Read: Story = { args: { read: true } };
export const Pending: Story = { args: { pending: true } };
