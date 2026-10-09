import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { WallProperties } from "@/features/floor-plan/editor/wall-properties";
import type { FloorPlanDocument } from "@/lib/floor-plan/types";

const initial: FloorPlanDocument = {
  schema: 1,
  unit: "mm",
  bounds: { w: 12000, h: 8000 },
  walls: [
    {
      id: "wall",
      points: [
        [1000, 2000],
        [11000, 2000],
      ],
      closed: false,
      thickness: 100,
    },
  ],
  openings: [{ id: "door", wallId: "wall", at: 0.5, width: 900, kind: "door" }],
  spaces: [],
  seats: [],
  fixtures: [],
};
function Example({ shapeId }: { shapeId: string }) {
  const [document, setDocument] = useState(initial);
  return (
    <section className="w-80 space-y-5 rounded-xl border bg-background p-5">
      <h2 className="font-bold">{shapeId === "wall" ? "벽" : "문·뚫린 곳"}</h2>
      <WallProperties
        document={document}
        shapeId={shapeId}
        onCommand={(command) => {
          if (command) setDocument(command.apply(document));
        }}
      />
    </section>
  );
}
const meta = {
  title: "운영자/PlanWallProperties",
  component: Example,
  args: { shapeId: "wall" },
} satisfies Meta<typeof Example>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Wall: Story = {};
export const Door: Story = { args: { shapeId: "door" } };
