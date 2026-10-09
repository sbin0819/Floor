import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Button } from "@/components/ui/button";
import { BackgroundCanvas } from "@/features/floor-plan/editor/background-canvas";

function BackgroundLayer({
  rotated = false,
  empty = false,
}: {
  rotated?: boolean;
  empty?: boolean;
}) {
  const [zoom, setZoom] = useState(1);
  const [opacity, setOpacity] = useState(0.35);
  const [failed, setFailed] = useState(false);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <p className="text-sm text-muted-foreground">
        로컬 시드 사진으로 변환·투명도만 보여주는 배경 레이어 예시예요. 실제
        도면, 파일 업로드, 외부 저장소는 쓰지 않아요.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => setZoom((value) => (value === 1 ? 1.5 : 1))}
        >
          확대 전환
        </Button>
        <Button
          variant="outline"
          onClick={() => setOpacity((value) => (value === 0.35 ? 0.7 : 0.35))}
        >
          투명도 전환
        </Button>
      </div>
      <div className="overflow-auto rounded-xl border bg-background">
        <div className="relative h-[460px] w-[720px]">
          <BackgroundCanvas
            background={
              empty
                ? undefined
                : {
                    transform: rotated
                      ? [0, 10, -10, 0, 5500, 0]
                      : [10, 0, 0, 10, 0, 0],
                    opacity,
                  }
            }
            src="/seed/photos/meeting-small-sage.webp"
            camera={{ scale: 0.055 * zoom, x: 30, y: 20 }}
            viewport={{ width: 720, height: 460 }}
            onLoadError={setFailed}
          />
          <div className="pointer-events-none absolute top-32 left-32 h-44 w-64 rounded-lg border-2 border-foreground p-3 text-sm">
            도형은 배경보다 위에 놓여요
          </div>
        </div>
      </div>
      {failed && (
        <p role="status" className="text-sm text-muted-foreground">
          배경 이미지를 불러오지 못했어요.
        </p>
      )}
    </div>
  );
}
const meta = {
  title: "운영자/PlanEditorBackgroundLayer",
  component: BackgroundLayer,
  tags: ["autodocs"],
} satisfies Meta<typeof BackgroundLayer>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Visible: Story = {};
export const Rotated: Story = { args: { rotated: true } };
export const Removed: Story = { args: { empty: true } };
