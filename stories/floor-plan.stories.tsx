import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PlanCanvas } from "@/features/floor-plan/components/plan-canvas";
import { PlanTimeBar } from "@/features/floor-plan/components/plan-time-bar";
import { planStatesAt, planSummary } from "@/features/floor-plan/states";
import { initialPlanTime, planTimeValueText } from "@/features/floor-plan/time";
import type { PlanShape } from "@/lib/floor-plan/render/types";
import {
  createFloorPlanStoryData,
  floorPlanStoryDocument,
} from "./floor-plan-fixtures";

function FloorPlanStory({
  maintenanceRestricted = false,
  holiday = false,
  loading = false,
}: {
  maintenanceRestricted?: boolean;
  holiday?: boolean;
  loading?: boolean;
}) {
  const data = useMemo(
    () => createFloorPlanStoryData({ maintenanceRestricted, holiday }),
    [maintenanceRestricted, holiday],
  );
  const [at, setAt] = useState(() => initialPlanTime(data));
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(null);
  const [hovered, setHovered] = useState<PlanShape | null>(null);
  const states = useMemo(
    () => planStatesAt(data, new Date(at ?? data.now)),
    [at, data],
  );
  const selected = data.spaces.find(
    (space) => space.kind === "accessible" && space.id === selectedSpaceId,
  );
  const hoveredState = hovered?.spaceId
    ? states.get(hovered.spaceId.toLowerCase())
    : null;
  const changeSelection = (spaceId: string | null) => {
    setSelectedSpaceId(spaceId);
    const url = new URL(window.location.href);
    if (spaceId) url.searchParams.set("space", spaceId);
    else url.searchParams.delete("space");
    window.history.pushState(window.history.state, "", url);
  };
  const choose = (shape: PlanShape) => {
    if (
      shape.spaceId &&
      states.get(shape.spaceId.toLowerCase())?.kind !== "restricted"
    )
      changeSelection(shape.spaceId);
  };
  return (
    <main
      data-floor-plan-story
      className="mx-auto w-full max-w-[1392px] space-y-4"
    >
      <header className="space-y-1">
        <h1 className="text-xl font-bold">강남점 7F · 평면도</h1>
        <p className="text-sm text-muted-foreground">
          실제 API·DB·로그인 흐름이 아닌 고정된 가짜 데이터 예제예요. 서울 시각
          2026년 10월 14일 11:30을 사용해요.
        </p>
      </header>
      <div
        className={
          selected
            ? "grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]"
            : "min-w-0"
        }
      >
        <section
          aria-label="층 평면도"
          className="min-w-0 overflow-hidden rounded-xl border border-border bg-card shadow-card"
        >
          {at === null ? (
            <p className="border-b border-border p-4">쉬는 날이에요</p>
          ) : (
            <PlanTimeBar
              data={data}
              at={at}
              onChange={setAt}
              summary={planSummary(data, states)}
            />
          )}
          {loading ? (
            <div
              role="status"
              aria-busy="true"
              className="m-4 h-[min(60dvh,640px)] min-h-96 animate-pulse rounded-xl border border-border bg-muted"
            >
              <span className="sr-only">평면도를 불러오고 있어요</span>
            </div>
          ) : (
            <div className="relative">
              <PlanCanvas
                document={floorPlanStoryDocument}
                states={states}
                selectedSpaceId={selectedSpaceId}
                onSelect={choose}
                onHover={setHovered}
                onClear={() => changeSelection(null)}
                timeLabel={
                  at === null
                    ? "쉬는 날이에요"
                    : `${planTimeValueText(at, data.branch.timezone)} 기준`
                }
              />
              {hoveredState && (
                <div
                  role="tooltip"
                  className="pointer-events-none absolute top-3 left-3 max-w-72 rounded-lg bg-foreground px-3 py-2 text-xs text-background shadow-pop"
                >
                  <p className="font-bold">{hoveredState.name}</p>
                  <p>
                    {hoveredState.kind === "restricted"
                      ? "다른 팀 전용이에요"
                      : hoveredState.label}
                  </p>
                </div>
              )}
            </div>
          )}
          <ul
            aria-label="평면도 범례"
            className="flex flex-wrap gap-4 border-t border-border p-4 text-xs"
          >
            {[
              ["비어 있음", "bg-status-free border-status-free-border"],
              ["예약됨", "bg-booked"],
              ["내 예약", "bg-status-mine-strong"],
              ["점검", "bg-status-maintenance-hatch"],
              ["전용 공간", "bg-status-restricted"],
            ].map(([label, className]) => (
              <li key={label} className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className={`size-3.5 rounded border border-border ${className}`}
                />
                {label}
              </li>
            ))}
          </ul>
        </section>
        {selected?.kind === "accessible" && (
          <aside
            aria-label={`${selected.name} 상세`}
            data-story-space-detail
            className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-card"
          >
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-bold">{selected.name} 상세</h2>
              <Button
                aria-label="예제 공간 상세 닫기"
                variant="ghost"
                size="icon"
                onClick={() => changeSelection(null)}
              >
                <X />
              </Button>
            </div>
            <p className="text-sm">{states.get(selected.id)?.label}</p>
            <p className="text-sm text-muted-foreground">
              실제 평면도의 선택 콜백으로 연 예제 상세예요. 예약 조회나 저장
              요청은 보내지 않아요.
            </p>
          </aside>
        )}
      </div>
    </main>
  );
}

const meta = {
  title: "FloorPlan",
  component: FloorPlanStory,
  parameters: {
    layout: "fullscreen",
    nextjs: { appDirectory: true },
    docs: {
      description: {
        component:
          "강남점 7F 문서와 순수 상태 계산을 사용하는 가짜 데이터 예제예요. 실제 API·DB·인증·예약 쓰기는 실행하지 않아요.",
      },
    },
  },
} satisfies Meta<typeof FloorPlanStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Normal: Story = {};
export const MaintenanceRestricted: Story = {
  args: { maintenanceRestricted: true },
};
export const Holiday: Story = { args: { holiday: true } };
export const Loading: Story = { args: { loading: true } };
