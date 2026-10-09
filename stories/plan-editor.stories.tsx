import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { EditorProperties } from "@/features/floor-plan/editor/editor-properties";
import { planEditorFixture } from "@/tests/helpers/plan-editor";
import { validatePlan } from "@/lib/floor-plan/validate";

type Example = "none" | "space" | "multiple" | "issues" | "fixture";
function PlanEditorPanel({ example = "space" }: { example?: Example }) {
  const [data] = useState(planEditorFixture);
  const [document, setDocument] = useState(() => {
    const doc = structuredClone(data.published!.document);
    if (example === "issues") {
      doc.spaces[1]!.polygon = [
        [3000, 2000],
        [6000, 2000],
        [6000, 6000],
        [3000, 6000],
      ];
      doc.spaces[1]!.label.at = [4500, 4000];
      doc.spaces[0]!.label.at = [1000, 1000];
    }
    return doc;
  });
  const [selectedIds, setSelectedIds] = useState<readonly string[]>(() =>
    example === "none"
      ? []
      : example === "fixture"
        ? ["fixture-core"]
        : example === "multiple"
          ? ["space-a", "space-b"]
          : ["space-a"],
  );
  const [snap, setSnap] = useState(true);
  const [notice, setNotice] = useState("");
  const issues = validatePlan(document, {
    floorId: data.floor.id,
    floorAccess: data.floor.access,
    floorAllowedTeamIds: data.floor.allowedTeamIds,
    spaces: data.spaces,
  });
  return (
    <div className="mx-auto w-80 max-w-full rounded-xl border bg-card text-card-foreground shadow-card">
      <EditorProperties
        branchId={data.branch.id}
        floorId={data.floor.id}
        document={document}
        spaces={data.spaces}
        selectedIds={selectedIds}
        issues={issues}
        validationPending={false}
        tool="select"
        snap={snap}
        onCommand={(command) => {
          if (command) {
            const next = command.apply(document);
            setDocument(next);
            const available = new Set(
              [...next.spaces, ...next.fixtures].map(({ id }) => id),
            );
            setSelectedIds((ids) => ids.filter((id) => available.has(id)));
            setNotice(`${command.label} — 예시 안에서만 바뀌어요.`);
          }
        }}
        onSelect={setSelectedIds}
        onSnap={setSnap}
        onConnect={() =>
          setNotice(
            "공간 연결 창은 실제 편집기에서 열어요. 이 예시는 DB를 읽지 않아요.",
          )
        }
        onCreatePolygon={() => {}}
      />
      {notice && (
        <p role="status" className="border-t p-5 text-sm text-muted-foreground">
          {notice}
        </p>
      )}
    </div>
  );
}

const meta = {
  title: "운영자/PlanEditor",
  component: PlanEditorPanel,
  tags: ["autodocs"],
  parameters: {
    nextjs: { appDirectory: true },
    docs: {
      description: {
        component:
          "가상 도면을 사용하는 편집기 오른쪽 패널이에요. 숫자·정렬·라벨 변경은 이 예시의 메모리에만 적용하며 실제 저장 액션, DB, 외부 서비스는 호출하지 않아요.",
      },
    },
  },
} satisfies Meta<typeof PlanEditorPanel>;
export default meta;
type Story = StoryObj<typeof meta>;
export const NothingSelected: Story = { args: { example: "none" } };
export const OneSpace: Story = { args: { example: "space" } };
export const MultipleShapes: Story = { args: { example: "multiple" } };
export const ValidationIssues: Story = { args: { example: "issues" } };
export const Fixture: Story = { args: { example: "fixture" } };
