import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { SpaceRowMenu } from "@/features/admin/components/space-row-menu";

const meta = {
  title: "운영자/SpaceRowMenu",
  component: SpaceRowMenu,
  tags: ["autodocs"],
  args: {
    name: "회의실 A",
    archived: false,
    canManage: true,
    pending: false,
    onEdit: () => {},
    onAccess: () => {},
    onArchive: () => {},
  },
  decorators: [
    (Story) => (
      <div className="flex min-h-72 w-96 max-w-full items-start justify-between rounded-xl border bg-card p-5">
        <div>
          <p className="font-semibold">회의실 A</p>
          <p className="text-sm text-muted-foreground">
            메뉴에서 공간 정보를 확인해요
          </p>
        </div>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SpaceRowMenu>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Active: Story = {};
export const Archived: Story = { args: { archived: true } };
export const ReadOnly: Story = { args: { canManage: false } };
export const Saving: Story = { args: { pending: true } };
