import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { samplePhotos } from "./photo-fixtures";
import { SpacePhoto } from "./space-photo";

const meta = {
  title: "사진/작은 사진",
  component: SpacePhoto,
  tags: ["autodocs"],
  args: {
    photo: samplePhotos[0]!,
    type: "meeting_room",
    size: { width: 72, height: 54 },
  },
} satisfies Meta<typeof SpacePhoto>;
export default meta;
type Story = StoryObj<typeof meta>;

export const WithPhoto: Story = {};
export const WithoutPhoto: Story = { args: { photo: null } };
export const Restricted: Story = {
  args: { photo: null, restricted: true },
};
export const BranchPlaceholder: Story = {
  args: { photo: null, type: "branch" },
};
export const Decorative: Story = {
  args: { decorative: true },
  render: (args) => (
    <div className="flex items-center gap-3">
      <SpacePhoto {...args} />
      <span>회의실 B</span>
    </div>
  ),
};
