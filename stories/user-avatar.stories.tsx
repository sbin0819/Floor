import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { UserAvatar } from "@/components/user-avatar";
import { AVATAR_COLORS } from "@/lib/avatar";
import { StatusDot } from "@/features/people/components/person-status";

const meta = {
  title: "People/UserAvatar",
  component: UserAvatar,
  args: {
    name: "김하은",
    avatar: { color: "blue", photoUrl: null },
    alt: "김하은",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof UserAvatar>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Colors: Story = {
  render: () => (
    <div className="flex flex-wrap gap-4">
      {AVATAR_COLORS.map((color) => (
        <UserAvatar
          key={color}
          name="김하은"
          avatar={{ color, photoUrl: null }}
          size={40}
          alt={`${color} 김하은`}
        />
      ))}
    </div>
  ),
};
export const Sizes: Story = {
  render: () => (
    <div className="flex flex-wrap items-end gap-4">
      {([20, 24, 28, 30, 32, 34, 36, 40, 60, 64, 72] as const).map((size) => (
        <UserAvatar
          key={size}
          name="박지훈"
          avatar={{ color: "green", photoUrl: null }}
          size={size}
          alt={`${size}px 박지훈`}
        />
      ))}
    </div>
  ),
};
export const Photo: Story = {
  args: {
    size: 72,
    avatar: {
      color: "purple",
      photoUrl: "/seed/photos/meeting-small-sage.webp",
    },
  },
};
export const FailedPhoto: Story = {
  args: {
    size: 72,
    avatar: { color: "orange", photoUrl: "/missing-story-avatar" },
  },
};
export const Status: Story = {
  render: () => (
    <div className="flex gap-6">
      {(["online", "away", "dnd", "offline", "unknown"] as const).map(
        (status) => (
          <UserAvatar
            key={status}
            name="이서연"
            avatar={{ color: "pink", photoUrl: null }}
            size={40}
            alt="이서연"
            status={<StatusDot status={status} />}
          />
        ),
      )}
    </div>
  ),
};
