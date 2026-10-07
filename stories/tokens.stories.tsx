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
];
function TokenTable() {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {colors.map((color) => (
        <div key={color} className="rounded-xl border bg-card p-5">
          <div
            className="mb-3 h-16 rounded-lg border"
            style={{ backgroundColor: `var(--${color})` }}
          />
          <span className="text-sm">{color}</span>
        </div>
      ))}
      <div className="rounded-xl border bg-card p-5">
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
