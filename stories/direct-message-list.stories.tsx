import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { DirectMessageList } from "@/features/chat/components/direct-message-list";
import type { DirectMessageNav } from "@/features/chat/types";

const rows: DirectMessageNav[] = ["이서연", "최민준", "박지훈"].map(
  (name, index) => ({
    roomId: `73000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    other: {
      userId: `73000000-0000-4000-8000-${String(index + 11).padStart(12, "0")}`,
      name,
      username: ["seoyeon.lee", "minjun.choi", "jihoon.park"][index]!,
    },
    lastSeq: 10,
    lastMessageAt: "2026-10-08T03:00:00Z",
    unread: true,
    unreadCount: 3,
    unreadMentions: index === 2 ? 1 : 0,
    muted: index === 2,
  }),
);
const meta = {
  title: "Chat/DirectMessages",
  component: DirectMessageList,
  tags: ["autodocs"],
  args: { rows, limit: 10 },
  decorators: [
    (Story) => (
      <div className="w-60 rounded-xl border border-border bg-sidebar p-3">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof DirectMessageList>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Recent: Story = {};
export const Empty: Story = { args: { rows: [] } };
export const Many: Story = {
  args: {
    rows: Array.from({ length: 12 }, (_, index) => ({
      ...rows[index % 3]!,
      roomId: `73000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    })),
  },
};
