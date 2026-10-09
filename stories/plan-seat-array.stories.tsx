import { useCallback, useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Button } from "@/components/ui/button";
import { SeatArrayPanel } from "@/features/floor-plan/editor/seat-array-panel";
import { SeatProperties } from "@/features/floor-plan/editor/seat-properties";
import type { Command } from "@/features/floor-plan/editor/commands";
import { EditorCanvas } from "@/features/floor-plan/editor/editor-canvas";
import {
  PlanEditorContext,
  useEditorStore,
  useEditorValue,
} from "@/features/floor-plan/editor/editor-context";
import { createPlanEditorStore } from "@/features/floor-plan/editor/store";
import type { PlanShapeState } from "@/lib/floor-plan/render/types";
import type { PlanSeat } from "@/lib/floor-plan/types";
import {
  seatAreaId,
  seatDocument,
  seatRows,
} from "@/tests/helpers/plan-seat-array";

function SeatArrayContent({
  example = "array",
}: {
  example?: "array" | "irregular" | "seat";
}) {
  const store = useEditorStore();
  const document = useEditorValue((value) => value.document);
  const undo = useEditorValue((value) => value.undoStack);
  const [preview, setPreview] = useState<readonly PlanSeat[] | null>(null);
  const [open, setOpen] = useState(true);
  const onPreview = useCallback(
    (seats: readonly PlanSeat[] | null) => setPreview(seats),
    [],
  );
  const onCommand = (command: Command) => {
    store.getState().execute(command);
  };
  const states = new Map<string, PlanShapeState>(
    seatRows.map(({ id, name, type }) => [
      id,
      { kind: "neutral", name, deskArea: type === "desk_area" },
    ]),
  );
  for (const seat of document.seats)
    states.set(seat.spaceId, {
      kind: "neutral",
      name: seat.label ?? "이름 없는 좌석",
    });
  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">강남점 7F · 좌석 배열 예시</h1>
          <p className="text-sm text-muted-foreground">
            가상 도면을 메모리에서만 바꿔요. 저장·게시·DB·외부 API를 호출하지
            않아요.
          </p>
        </div>
        <Button
          variant="outline"
          disabled={!undo.length}
          onClick={() => store.getState().undo()}
        >
          실행 취소
        </Button>
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="min-w-0 space-y-2">
          <main className="relative h-[600px] overflow-hidden rounded-xl border bg-card">
            <EditorCanvas
              states={states}
              onPolygon={() => {}}
              previewSeats={preview}
            />
          </main>
          <p className="text-sm text-muted-foreground tabular-nums">
            적용된 좌석 {document.seats.length}개 · 실행 취소 {undo.length}회
            {preview ? ` · 미리보기 ${preview.length}개` : ""}
          </p>
        </section>
        <aside className="rounded-xl border bg-card text-card-foreground shadow-card">
          {example === "seat" ? (
            <SeatProperties
              document={document}
              seatId={document.seats[0]!.id}
              displayName="A-01"
              bookingCount={2}
              onCommand={onCommand}
            />
          ) : open ? (
            <SeatArrayPanel
              document={document}
              areaId={seatAreaId}
              spaces={seatRows}
              onCommand={onCommand}
              onPreview={onPreview}
              onCancel={() => setOpen(false)}
            />
          ) : (
            <div className="p-5">
              <Button onClick={() => setOpen(true)}>좌석 배열 열기</Button>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function SeatArrayExample({
  example = "array",
}: {
  example?: "array" | "irregular" | "seat";
}) {
  const [store] = useState(() => {
    const document = seatDocument();
    if (example === "irregular")
      document.seats[3] = {
        ...document.seats[3]!,
        at: [11000, 11300],
        rotation: 90,
      };
    const value = createPlanEditorStore({
      floorId: seatRows[0]!.floorId,
      basePlanId: null,
      document,
      draft: null,
      savedAt: null,
    });
    value
      .getState()
      .select(example === "seat" ? [document.seats[0]!.id] : [seatAreaId]);
    value.getState().setTool(example === "seat" ? "select" : "seat-array");
    return value;
  });
  return (
    <PlanEditorContext value={store}>
      <SeatArrayContent example={example} />
    </PlanEditorContext>
  );
}

const meta = {
  title: "운영자/PlanSeatArray",
  component: SeatArrayExample,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen", nextjs: { appDirectory: true } },
} satisfies Meta<typeof SeatArrayExample>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Existing7F: Story = { args: { example: "array" } };
export const Irregular: Story = { args: { example: "irregular" } };
export const IndividualSeat: Story = { args: { example: "seat" } };
