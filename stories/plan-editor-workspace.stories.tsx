import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PlanEditor } from "@/features/floor-plan/editor/plan-editor";
import { saveFloorPlanDraftSchema } from "@/features/floor-plan/editor-schema";
import type { SaveFloorPlanDraftResult } from "@/features/floor-plan/editor-types";
import type { ActionResult } from "@/lib/actions/result";
import { planEditorFixture, planEditorIds } from "@/tests/helpers/plan-editor";

const pathname = `/admin/branches/${planEditorIds.branch}/floors/${planEditorIds.floor}/plan`;
async function saveInMemory(
  input: unknown,
): Promise<ActionResult<SaveFloorPlanDraftResult>> {
  const parsed = saveFloorPlanDraftSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "INVALID_INPUT" };
  return {
    ok: true,
    data: {
      planId: "a8000000-0000-4000-8000-000000000007",
      version: 2,
      revision: (parsed.data.revision ?? 0) + 1,
      savedAt: "2026-10-09T03:00:00.000Z",
    },
  };
}

function WorkspaceStory() {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { mutations: { retry: false } } }),
  );
  const [data] = useState(() => {
    const fixture = planEditorFixture();
    fixture.canManageSpaces = false;
    fixture.spaces.push({
      ...fixture.spaces[0]!,
      id: planEditorIds.spaceC,
      name: "회의실 6C",
      capacity: 4,
      amenities: [],
    });
    return fixture;
  });
  return (
    <QueryClientProvider client={client}>
      <div className="-m-6">
        <PlanEditor data={data} save={saveInMemory} />
      </div>
    </QueryClientProvider>
  );
}

const meta = {
  title: "운영자/PlanEditorWorkspace",
  component: WorkspaceStory,
  parameters: {
    layout: "fullscreen",
    nextjs: { appDirectory: true, navigation: { pathname } },
    docs: {
      description: {
        component:
          "전체 편집기 예시예요. 사각형을 그려 아직 도형이 없는 회의실 6C에 연결하거나 고정물을 만들 수 있어요. 1.5초 자동 저장은 고정된 가짜 성공 결과만 반환하고, 새 공간 만들기는 끄며, 서버·DB·외부 서비스는 호출하지 않아요. 1024px 미만에서는 편집 대신 안내를 보여줘요.",
      },
    },
  },
} satisfies Meta<typeof WorkspaceStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
