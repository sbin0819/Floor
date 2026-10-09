import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { BackgroundPanel } from "@/features/floor-plan/editor/background-panel";
import { createPlanAutosave } from "@/features/floor-plan/editor/autosave";
import {
  PlanEditorContext,
  useEditorStore,
  useEditorValue,
} from "@/features/floor-plan/editor/editor-context";
import { createPlanEditorStore } from "@/features/floor-plan/editor/store";
import type { Point } from "@/lib/floor-plan/render/types";
import { editorDocument } from "@/tests/helpers/plan-editor-store";

const planId = "e9000000-0000-4000-8000-000000000001";
const uploadId = "e9000000-0000-4000-8000-000000000002";
type Example = "empty" | "image" | "locked" | "disabled";

function Content({ example }: { example: Example }) {
  const store = useEditorStore();
  const document = useEditorValue((value) => value.document);
  const canUndo = useEditorValue((value) => value.undoStack.length > 0);
  const [locked, setLocked] = useState(example === "locked");
  const [scalePoints, setScalePoints] = useState<readonly Point[]>([]);
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    example === "empty" ? null : { width: 1600, height: 1000 },
  );
  const [autosave] = useState(() =>
    createPlanAutosave(store, {
      save: async (input) => ({
        ok: true,
        data: {
          planId,
          version: 2,
          revision: (input.revision ?? 0) + 1,
          savedAt: "2026-10-09T00:00:00.000Z",
        },
      }),
    }),
  );
  useEffect(() => {
    autosave.start();
    return () => autosave.stop();
  }, [autosave]);
  return (
    <div className="mx-auto max-w-3xl space-y-5 p-6">
      <header className="space-y-2">
        <h1 className="text-xl font-bold">배경 도면 패널</h1>
        <p className="text-sm text-muted-foreground">
          가상 자료로만 동작해요. 파일을 골라도 실제 변환·API·R2 요청은 하지
          않아요. 두 점 찍기는 미리 정한 두 점을 사용해요.
        </p>
      </header>
      <div className="grid items-start gap-5 sm:grid-cols-[minmax(0,1fr)_320px]">
        <section className="space-y-4 rounded-xl border bg-card p-5">
          <h2 className="font-semibold">메모리 문서</h2>
          <p className="text-sm">
            {document.background ? "배경 있음" : "배경 없음"} ·{" "}
            {locked ? "잠김" : "잠금 해제됨"}
          </p>
          <p className="text-sm break-all text-muted-foreground tabular-nums">
            {document.background
              ? `행렬 ${document.background.transform.join(", ")} · 투명도 ${Math.round(document.background.opacity * 100)}%`
              : "올리면 기본 배율 1px = 10mm로 시작해요."}
          </p>
          <Button
            variant="outline"
            disabled={!canUndo}
            onClick={() => store.getState().undo()}
          >
            실행 취소
          </Button>
        </section>
        <aside className="rounded-xl border bg-card shadow-card">
          <BackgroundPanel
            enabled={example !== "disabled"}
            active
            autosave={autosave}
            locked={locked}
            onLockedChange={setLocked}
            scalePoints={scalePoints}
            onScaleStart={() =>
              setScalePoints([
                [0, 0],
                [10000, 0],
              ])
            }
            onScaleEnd={() => setScalePoints([])}
            imageSize={size}
            onUploaded={(value) => {
              setSize(value);
              setLocked(true);
            }}
            convert={async () => ({
              blob: new Blob(["fake-webp"], { type: "image/webp" }),
              width: 1600,
              height: 1000,
            })}
            createUpload={async () => ({
              ok: true,
              data: {
                planId,
                uploadId,
                url: "https://invalid.example/story-only",
              },
            })}
            upload={async (_url, _blob, options) => {
              options?.onProgress?.(100);
            }}
            confirmUpload={async () => ({
              ok: true,
              data: { planId, uploadId, width: 1600, height: 1000 },
            })}
          />
        </aside>
      </div>
    </div>
  );
}
function BackgroundExample({ example = "empty" }: { example?: Example }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          mutations: { retry: false },
          queries: { retry: false },
        },
      }),
  );
  const [store] = useState(() => {
    const document = editorDocument();
    if (example !== "empty")
      document.background = { transform: [10, 0, 0, 10, 0, 0], opacity: 0.35 };
    return createPlanEditorStore({
      floorId: "e9000000-0000-4000-8000-000000000003",
      basePlanId: null,
      document,
      draft: { planId, version: 2, revision: 1 },
      savedAt: "2026-10-09T00:00:00.000Z",
    });
  });
  return (
    <QueryClientProvider client={client}>
      <PlanEditorContext value={store}>
        <Content example={example} />
      </PlanEditorContext>
    </QueryClientProvider>
  );
}
const meta = {
  title: "운영자/PlanBackground",
  component: BackgroundExample,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof BackgroundExample>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Empty: Story = { args: { example: "empty" } };
export const Image: Story = { args: { example: "image" } };
export const Locked: Story = { args: { example: "locked" } };
export const Disabled: Story = { args: { example: "disabled" } };
