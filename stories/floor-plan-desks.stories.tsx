import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { PlanCanvas } from "@/features/floor-plan/components/plan-canvas";
import { planStatesAt } from "@/features/floor-plan/states";
import { deskPartLabels, type DeskPart } from "@/features/bookings/desk-parts";
import type { DeskState } from "@/features/bookings/types";
import {
  createFloorPlanStoryData,
  floorPlanStoryDocument,
} from "./floor-plan-fixtures";

const stateLabels: Record<DeskState, string> = {
  free: "비어 있음",
  booked: "예약됨",
  mine: "내 자리",
  blocked: "점검",
  unavailable: "예약할 수 없는 자리",
};
const seats = floorPlanStoryDocument.seats.map((seat, index) => ({
  id: seat.spaceId,
  name: `A-${String(index + 1).padStart(2, "0")}`,
}));
function seatState(index: number, part: DeskPart): DeskState {
  if (index === 1) return part === "pm" ? "free" : "booked";
  if (index === 2) return "mine";
  if (index === 3) return "blocked";
  if (index === 4) return "unavailable";
  return "free";
}
function DeskPlanStory() {
  const data = useMemo(() => createFloorPlanStoryData(), []);
  const area = data.spaces.find((space) => space.type === "desk_area")!;
  const [active, setActive] = useState(true);
  const [part, setPart] = useState<DeskPart>("pm");
  const [selected, setSelected] = useState<string | null>(null);
  const values = useMemo(() => {
    const states = new Map(planStatesAt(data, new Date(data.now)));
    if (active)
      seats.forEach((seat, index) => {
        const state = seatState(index, part);
        states.set(seat.id, {
          kind:
            state === "blocked" || state === "unavailable"
              ? "maintenance"
              : state,
          name: seat.name,
          label: stateLabels[state],
          selectable: state === "free" || state === "mine",
          selected: seat.id === selected,
        });
      });
    return states;
  }, [data, active, part, selected]);
  const close = () => {
    setActive(false);
    setSelected(null);
  };
  const chosen = seats.find((seat) => seat.id === selected);
  return (
    <main className="mx-auto w-full max-w-[1392px] space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl font-bold">
          강남점 7F · 평면도에서 좌석 고르기
        </h1>
        <p className="text-sm text-muted-foreground">
          고정된 가짜 좌석 데이터예요. 실제 API·DB·예약 쓰기는 실행하지 않아요.
          구역을 닫으면 확대 전 위치로 돌아가요.
        </p>
      </header>
      <div
        className={
          active ? "grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]" : "min-w-0"
        }
      >
        <section className="min-w-0 overflow-hidden rounded-xl border border-border bg-card">
          <PlanCanvas
            document={floorPlanStoryDocument}
            states={values}
            selectedSpaceId={active ? area.id : null}
            activeDeskAreaId={active ? area.id : null}
            selectedSeatId={selected}
            timeLabel="11시 30분 기준"
            onClear={close}
            onSelect={(shape) => {
              if (shape.kind === "space") {
                if (shape.spaceId === area.id) setActive(true);
                return;
              }
              if (
                shape.kind !== "seat" ||
                !shape.spaceId ||
                !values.get(shape.spaceId)?.selectable
              )
                return;
              setSelected((current) =>
                current === shape.spaceId ? null : shape.spaceId,
              );
            }}
          />
        </section>
        {active && (
          <aside
            aria-label="좌석 상세 예제"
            className="space-y-4 rounded-xl border border-border bg-card p-4"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-bold">오픈 데스크</h2>
              <Button variant="ghost" onClick={close}>
                구역 닫기
              </Button>
            </div>
            <RadioGroup
              aria-label="좌석 이용 시간"
              value={part}
              onValueChange={(value) => {
                if (value !== "am" && value !== "pm" && value !== "day") return;
                setPart(value);
                if (
                  selected &&
                  seatState(
                    seats.findIndex((seat) => seat.id === selected),
                    value,
                  ) !== "free"
                )
                  setSelected(null);
              }}
              className="grid grid-cols-3"
            >
              {(["am", "pm", "day"] as const).map((value) => (
                <label
                  key={value}
                  className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border px-2 text-sm"
                >
                  <RadioGroupItem value={value} />
                  {deskPartLabels[value]}
                </label>
              ))}
            </RadioGroup>
            <p aria-live="polite" className="font-semibold">
              {chosen
                ? `${chosen.name} · ${deskPartLabels[part]}`
                : "평면도에서 자리를 골라 주세요"}
            </p>
            <ul className="space-y-2 text-sm">
              <li>빈 자리와 내 자리를 고를 수 있어요.</li>
              <li>예약·점검·이용 불가 자리도 방향키로 확인할 수 있어요.</li>
              <li>Enter·Space로 선택하고 Escape로 구역을 나가요.</li>
            </ul>
            <Button className="w-full" disabled>
              예약 저장은 하지 않는 예제예요
            </Button>
          </aside>
        )}
      </div>
    </main>
  );
}
const meta = {
  title: "FloorPlan/Desks",
  component: DeskPlanStory,
  parameters: { layout: "fullscreen", nextjs: { appDirectory: true } },
} satisfies Meta<typeof DeskPlanStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const ZoomedArea: Story = {};
