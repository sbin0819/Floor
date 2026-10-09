import { Activity } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  PlanEditor,
  editorSource,
} from "@/features/floor-plan/editor/plan-editor";
import {
  useEditorStore,
  useEditorValue,
} from "@/features/floor-plan/editor/editor-context";
import { moveShapesCommand } from "@/features/floor-plan/editor/transforms";
import type { PlanEditorStore } from "@/features/floor-plan/editor/store";
import type { SaveFloorPlanDraftResult } from "@/features/floor-plan/editor-types";
import type { ActionResult } from "@/lib/actions/result";
import type { PlanPoint } from "@/lib/floor-plan/types";
import { planEditorFixture, planEditorIds } from "@/tests/helpers/plan-editor";

const mocks = vi.hoisted(() => ({
  pathname: "",
  search: "",
  replace: vi.fn(),
  refresh: vi.fn(),
  wide: true,
  store: null as PlanEditorStore | null,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useSearchParams: () => new URLSearchParams(mocks.search),
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }),
}));
vi.mock("@/features/floor-plan/actions", () => ({
  saveFloorPlanDraft: vi.fn(),
}));
vi.mock("@/features/admin/actions", () => ({
  createSpace: vi.fn(),
  updateSpace: vi.fn(),
}));
vi.mock("@/features/bookings/components/use-wide-screen", () => ({
  useWideScreen: () => mocks.wide,
}));
vi.mock("@/features/floor-plan/components/plan-canvas", () => ({
  PlanCanvas: () => <p>멤버 렌더러</p>,
}));
vi.mock("@/features/floor-plan/editor/editor-canvas", () => ({
  EditorCanvas: ({
    onPolygon,
  }: {
    onPolygon: (polygon: PlanPoint[]) => void;
  }) => {
    const store = useEditorStore();
    mocks.store = store;
    const count = useEditorValue((state) => state.document.spaces.length);
    return (
      <div>
        <output aria-label="공간 도형 수">{count}</output>
        <button
          onClick={() =>
            onPolygon([
              [1000, 1000],
              [5000, 1000],
              [5000, 4000],
              [1000, 4000],
            ])
          }
        >
          첫 사각형 그리기
        </button>
        <button
          onClick={() =>
            onPolygon([
              [8000, 5000],
              [11000, 5000],
              [11000, 9000],
              [8000, 9000],
            ])
          }
        >
          둘째 사각형 그리기
        </button>
        <button
          onClick={() => {
            const state = store.getState();
            state.execute(
              moveShapesCommand(
                state.document,
                [state.document.spaces[1]!.id],
                [-5000, -3000],
                { snap: false },
              ),
            );
          }}
        >
          겹치게 옮기기
        </button>
      </div>
    );
  },
}));
const path = `/admin/branches/${planEditorIds.branch}/floors/${planEditorIds.floor}/plan`;
const result: ActionResult<SaveFloorPlanDraftResult> = {
  ok: true,
  data: {
    planId: "b8000000-0000-4000-8000-000000000001",
    version: 2,
    revision: 1,
    savedAt: "2026-10-09T02:42:00.000Z",
  },
};
function empty() {
  const data = planEditorFixture();
  data.published = null;
  return data;
}
it("hydrates legacy seat names only in the editor source without changing the published document", () => {
  const data = planEditorFixture();
  data.published!.document.seats = [
    {
      id: "seat-one",
      spaceId: planEditorIds.spaceC,
      at: [2000, 2000],
      size: [1400, 700],
      rotation: 0,
    },
  ];
  data.spaces.push({
    ...data.spaces[0]!,
    id: planEditorIds.spaceC,
    type: "desk",
    name: "A-01",
  });
  const source = editorSource(data);
  expect(source.document.seats[0]).toHaveProperty("label", "A-01");
  expect(data.published!.document.seats[0]).not.toHaveProperty("label");
  expect(source.draft).toBeNull();
});
function mount(
  data = empty(),
  save = vi
    .fn<(input: unknown) => Promise<ActionResult<SaveFloorPlanDraftResult>>>()
    .mockResolvedValue(result),
) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  const content = (
    next = data,
    readKey: string | null = null,
    hidden = false,
  ) => (
    <QueryClientProvider client={client}>
      <Activity mode={hidden ? "hidden" : "visible"}>
        <PlanEditor data={next} readKey={readKey} save={save} />
      </Activity>
    </QueryClientProvider>
  );
  return { ...render(content()), content, save, client };
}
async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
function first() {
  fireEvent.click(screen.getByRole("button", { name: "첫 사각형 그리기" }));
  fireEvent.click(
    screen.getByRole("button", { name: /회의실 6A ·|회의실 6A회의실/ }),
  );
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.pathname = path;
  mocks.search = "";
  mocks.wide = true;
  mocks.store = null;
});
afterEach(() => {
  vi.useRealTimers();
});
it("connects two drawings, validates overlap, undoes and saves the latest document once", async () => {
  const app = mount();
  first();
  fireEvent.click(screen.getByRole("button", { name: "둘째 사각형 그리기" }));
  fireEvent.click(screen.getByRole("button", { name: /세미나실/ }));
  await tick(200);
  expect(screen.getByRole("button", { name: "검사 문제 0" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "겹치게 옮기기" }));
  await tick(200);
  expect(screen.getByRole("button", { name: "검사 문제 1" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "실행 취소" }));
  await tick(1500);
  expect(app.save).toHaveBeenCalledTimes(1);
  expect(app.save.mock.calls[0]).toHaveLength(1);
  expect(app.save.mock.calls[0]![0]).toMatchObject({
    floorId: planEditorIds.floor,
    basePlanId: null,
    revision: null,
    document: {
      spaces: [
        expect.objectContaining({ spaceId: planEditorIds.spaceA }),
        expect.objectContaining({ spaceId: planEditorIds.spaceB }),
      ],
    },
  });
  expect(screen.getByText(/자동 저장됨 11:42/)).toBeVisible();
  expect(mocks.store!.getState().undoStack).toHaveLength(2);
});
it("closing a connection dialog leaves the document and autosave untouched", async () => {
  const { save } = mount();
  fireEvent.click(screen.getByRole("button", { name: "첫 사각형 그리기" }));
  fireEvent.click(screen.getByRole("button", { name: "닫기" }));
  await tick(2000);
  expect(screen.getByLabelText("공간 도형 수")).toHaveTextContent("0");
  expect(save).not.toHaveBeenCalled();
});
it("returns focus to the preview button without changing the document", async () => {
  const { save } = mount();
  const preview = screen.getByRole("button", { name: "멤버 화면 미리보기" });
  preview.focus();
  fireEvent.click(preview);
  expect(screen.getByRole("dialog")).toHaveTextContent("멤버 렌더러");
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  await tick(0);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(preview).toHaveFocus();
  expect(save).not.toHaveBeenCalled();
});
it("keeps local edits and undo history when space metadata refreshes", async () => {
  const data = empty();
  const app = mount(data);
  first();
  const changed = {
    ...data,
    spaces: data.spaces.map((space) => ({
      ...space,
      name: `${space.name} 새 이름`,
    })),
  };
  app.rerender(app.content(changed));
  expect(mocks.store!.getState().document.spaces).toHaveLength(1);
  expect(mocks.store!.getState().undoStack).toHaveLength(1);
  expect(
    screen.getByRole("button", { name: /회의실 6A 새 이름/ }),
  ).toBeVisible();
  await tick(1500);
  expect(app.save).toHaveBeenCalledOnce();
});
it("shows a retry after failure without retry loops and retries the current document", async () => {
  const save = vi
    .fn<(input: unknown) => Promise<ActionResult<SaveFloorPlanDraftResult>>>()
    .mockResolvedValueOnce({ ok: false, code: "INTERNAL" })
    .mockResolvedValue(result);
  mount(empty(), save);
  first();
  await tick(1500);
  await tick(10000);
  expect(save).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  await tick(0);
  expect(save).toHaveBeenCalledTimes(2);
});
it("only adopts the requested reload response after STALE, leaving controls blocked until then", async () => {
  const save = vi
    .fn<(input: unknown) => Promise<ActionResult<SaveFloorPlanDraftResult>>>()
    .mockResolvedValue({ ok: false, code: "STALE" });
  const app = mount(empty(), save);
  first();
  await tick(1500);
  expect(screen.getByRole("dialog")).toHaveTextContent(
    "다른 곳에서 이 초안을 바꿨어요",
  );
  expect(
    document.querySelector('button[aria-label="실행 취소"]'),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "새로 불러오기" }));
  const url = mocks.replace.mock.lastCall![0] as string;
  const key = new URL(url, "https://example.test").searchParams.get("reload")!;
  app.rerender(app.content(planEditorFixture(), "old-response"));
  expect(mocks.store!.getState().document.spaces).toHaveLength(1);
  app.rerender(app.content(planEditorFixture(), key));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(mocks.store!.getState().document.spaces).toHaveLength(2);
  expect(mocks.store!.getState().undoStack).toHaveLength(0);
  app.rerender(app.content(empty(), key));
  expect(mocks.store!.getState().document.spaces).toHaveLength(2);
});
it("preserves an in-flight first-save ACK across Activity hiding and does not reset on return", async () => {
  let resolve!: (value: ActionResult<SaveFloorPlanDraftResult>) => void;
  const save = vi.fn<
    (input: unknown) => Promise<ActionResult<SaveFloorPlanDraftResult>>
  >(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const data = empty();
  const app = mount(data, save);
  first();
  await tick(1500);
  app.rerender(app.content(data, null, true));
  await act(async () => resolve(result));
  app.rerender(app.content(data));
  expect(mocks.store!.getState().draft?.revision).toBe(1);
  expect(mocks.store!.getState().document.spaces).toHaveLength(1);
  expect(save).toHaveBeenCalledOnce();
});
it("flushes a dirty document on tab hiding and protects beforeunload only while dirty", async () => {
  const app = mount();
  first();
  const dirty = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(dirty);
  expect(dirty.defaultPrevented).toBe(true);
  const visibility = vi
    .spyOn(document, "visibilityState", "get")
    .mockReturnValue("hidden");
  fireEvent(document, new Event("visibilitychange"));
  await tick(0);
  expect(app.save).toHaveBeenCalledOnce();
  const clean = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(clean);
  expect(clean.defaultPrevented).toBe(false);
  visibility.mockRestore();
});
it("does not mount the interactive canvas or autosave on a narrow screen", async () => {
  mocks.wide = false;
  const app = mount();
  await tick(2000);
  expect(
    screen.getByText("평면도 편집은 1024px 이상 화면에서 할 수 있어요"),
  ).toBeInTheDocument();
  expect(screen.queryByLabelText("공간 도형 수")).not.toBeInTheDocument();
  expect(app.save).not.toHaveBeenCalled();
});
it("keeps unsaved unload protection and scheduled saves after narrowing the window", async () => {
  const data = empty();
  const app = mount(data);
  first();
  mocks.wide = false;
  app.rerender(app.content(data));
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  await tick(1500);
  expect(app.save).toHaveBeenCalledOnce();
});
it("saves a canonical floor from an uppercase UUID URL", async () => {
  mocks.pathname = path
    .replace(planEditorIds.branch, planEditorIds.branch.toUpperCase())
    .replace(planEditorIds.floor, planEditorIds.floor.toUpperCase());
  const app = mount();
  first();
  await tick(1500);
  expect(app.save).toHaveBeenCalledOnce();
});
it("selects the initial draft over the published source and never starts a clean save", async () => {
  const data = planEditorFixture();
  const doc = { ...data.published!.document, fixtures: [] };
  data.draft = {
    planId: "draft",
    version: 2,
    revision: 9,
    document: doc,
    updatedAt: "2026-10-09T02:00:00.000Z",
    updatedByName: "김도윤",
  };
  expect(editorSource(data)).toMatchObject({
    basePlanId: planEditorIds.plan,
    draft: { revision: 9 },
    document: doc,
  });
  const app = mount(data);
  await tick(3000);
  expect(app.save).not.toHaveBeenCalled();
});
