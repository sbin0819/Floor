import type { Meta, StoryObj } from "@storybook/nextjs-vite";

function Typography() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-[-0.01em]">오늘의 7층</h1>
      <h2 className="text-xl font-semibold">회의실 B</h2>
      <h3 className="text-base font-semibold">오늘 일정</h3>
      <p className="text-sm">빈 시간을 선택해 공간을 예약해요.</p>
      <p className="text-xs text-muted-foreground">
        7층 · 최대 6인이 이용할 수 있어요.
      </p>
      <p className="tabular-nums">15:00–16:00 · 24석</p>
    </div>
  );
}
const meta = {
  title: "디자인 토큰/타이포",
  component: Typography,
  tags: ["autodocs"],
} satisfies Meta<typeof Typography>;
export default meta;
export const Scale: StoryObj<typeof meta> = {};
