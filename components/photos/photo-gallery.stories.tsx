import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { samplePhotos } from "./photo-fixtures";
import { PhotoGallery } from "./photo-gallery";

const meta = {
  title: "사진/넘겨 보기",
  component: PhotoGallery,
  tags: ["autodocs"],
  args: {
    photos: samplePhotos,
    name: "회의실 B",
    type: "meeting_room",
    eager: true,
    sizes: "420px",
  },
  decorators: [
    (Story) => (
      <div className="w-full max-w-[420px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PhotoGallery>;
export default meta;
type Story = StoryObj<typeof meta>;

export const NoPhotos: Story = { args: { photos: [] } };
export const OnePhoto: Story = { args: { photos: samplePhotos.slice(0, 1) } };
export const ThreePhotos: Story = {};
