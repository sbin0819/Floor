import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useMemo, useState } from "react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { PlanCanvas } from "@/features/floor-plan/components/plan-canvas";
import { PlanSpaceSummary } from "@/features/floor-plan/components/plan-space-summary";
import { PlanTouchHint } from "@/features/floor-plan/components/plan-touch-hint";
import { planStatesAt } from "@/features/floor-plan/states";
import type { SpaceDayData } from "@/features/bookings/types";
import {
  createFloorPlanStoryData,
  floorPlanStoryDocument,
  floorPlanStorySpaceIds,
} from "./floor-plan-fixtures";

function MobilePlanStory() {
  const floor = useMemo(() => createFloorPlanStoryData(), []);
  const [selected, setSelected] = useState<string | null>(
    floorPlanStorySpaceIds.meetingB,
  );
  const space = floor.spaces.find((row) => row.id === selected);
  const detail: SpaceDayData | null =
    space?.kind === "accessible"
      ? {
          space,
          desk: null,
          photos: [],
          branch: floor.branch,
          floor: floor.floor,
          date: floor.date,
          now: floor.now,
          openHours: floor.openHours,
          bookings: space.intervals
            .filter(({ kind }) => kind !== "maintenance")
            .map((interval, index) => ({
              id: `story-${index}`,
              start: interval.start,
              end: interval.end,
              isMine: interval.kind === "mine",
              bookerName: "가상 회원",
              canCancel: false,
            })),
          blocks: [],
          actors: [],
          hasTeams: false,
        }
      : null;
  return (
    <main className="mx-auto max-w-2xl">
      <h1 className="mb-3 text-xl font-bold">강남점 7F · 모바일 평면도</h1>
      <p className="mb-3 text-sm text-muted-foreground">
        가짜 데이터 예제예요. 시트 뒤의 평면도도 움직일 수 있어요.
      </p>
      <PlanTouchHint />
      <PlanCanvas
        document={floorPlanStoryDocument}
        states={planStatesAt(floor, new Date(floor.now))}
        selectedSpaceId={selected}
        onSelect={(shape) => setSelected(shape.spaceId)}
        onClear={() => setSelected(null)}
      />
      <Sheet
        modal={false}
        open={Boolean(detail)}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <SheetContent
          side="bottom"
          showCloseButton={false}
          aria-describedby={undefined}
          className="max-h-[50dvh] overflow-y-auto rounded-t-xl"
          onInteractOutside={(event) => event.preventDefault()}
        >
          <SheetTitle className="sr-only">공간 상세</SheetTitle>
          {detail && <PlanSpaceSummary data={detail} now={floor.now} />}
        </SheetContent>
      </Sheet>
    </main>
  );
}
const meta = {
  title: "FloorPlan/Mobile",
  component: MobilePlanStory,
  parameters: {
    layout: "fullscreen",
    viewport: { defaultViewport: "mobile1" },
    nextjs: { appDirectory: true },
  },
} satisfies Meta<typeof MobilePlanStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const SummarySheet: Story = {};
