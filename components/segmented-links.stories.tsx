import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { SegmentedLink, SegmentedLinks } from "./segmented-links";

const meta = {
  title: "컴포넌트/SegmentedLinks",
  component: SegmentedLinks,
  tags: ["autodocs"],
  args: { label: "층 선택" },
} satisfies Meta<typeof SegmentedLinks>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Floors: Story = {
  render: (args) => (
    <SegmentedLinks {...args}>
      {["6F", "7F", "8F"].map((floor) => (
        <SegmentedLink key={floor} href={`#${floor}`} selected={floor === "7F"}>
          {floor}
        </SegmentedLink>
      ))}
    </SegmentedLinks>
  ),
};
export const Views: Story = {
  args: { label: "보기 선택" },
  render: (args) => (
    <SegmentedLinks {...args}>
      <SegmentedLink href="#list" selected>
        목록
      </SegmentedLink>
      <SegmentedLink href="#timeline" selected={false}>
        시간표
      </SegmentedLink>
    </SegmentedLinks>
  ),
};
