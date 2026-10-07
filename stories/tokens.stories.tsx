import type { Meta, StoryObj } from "@storybook/nextjs-vite";

const colors = [
  "background",
  "foreground",
  "card",
  "primary",
  "secondary",
  "muted",
  "accent",
  "destructive",
  "border",
  "input",
  "ring",
  "status-free",
  "status-busy",
  "status-mine",
  "status-restricted",
  "status-pending",
  "booked",
  "booked-border",
  "booked-foreground",
  "booked-strong",
];
function TokenTable() {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {colors.map((color) => (
        <div key={color} className="rounded-xl border bg-card p-5 shadow-card">
          <div
            className="mb-3 h-16 rounded-lg border"
            style={{ backgroundColor: `var(--${color})` }}
          />
          <span className="text-sm">{color}</span>
        </div>
      ))}
      <div className="rounded-xl border bg-card p-5 shadow-card">
        <div className="mb-3 h-16 rounded-lg border bg-status-maintenance-hatch" />
        <span>status-maintenance-hatch</span>
      </div>
    </div>
  );
}
const meta = {
  title: "디자인 토큰/색",
  component: TokenTable,
  tags: ["autodocs"],
} satisfies Meta<typeof TokenTable>;
export default meta;
export const Colors: StoryObj<typeof meta> = {};
export const Surfaces: StoryObj<typeof meta> = {
  render: () => (
    <div className="grid gap-8 p-8 sm:grid-cols-2">
      <div className="rounded-xl border bg-card p-5 shadow-card">
        <h2 className="text-[15px] font-semibold">카드 · 14px</h2>
        <p className="mt-2 text-muted-foreground">shadow-card</p>
        <div className="mt-4 rounded-lg border border-booked-border bg-booked p-3 text-booked-foreground">
          예약됨 · 컨트롤 10px
        </div>
      </div>
      <div className="rounded-xl border bg-popover p-5 text-popover-foreground shadow-pop">
        <h2 className="text-[15px] font-semibold">뜨는 영역</h2>
        <p className="mt-2 text-muted-foreground">shadow-pop</p>
      </div>
    </div>
  ),
};
