import { Activity, useState, type ComponentProps } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EditorProperties } from "@/features/floor-plan/editor/editor-properties";
import { EditorConnectDialog } from "@/features/floor-plan/editor/editor-connect-dialog";
import {
  PlanEditorFrame,
  PlanEditorSkeleton,
} from "@/features/floor-plan/editor/editor-frame";
import {
  planEditorDocument,
  planEditorFixture,
  planEditorIds,
} from "@/tests/helpers/plan-editor";
import { pointInPolygonStrict } from "@/lib/floor-plan/geometry";
import type { FloorPlanDocument } from "@/lib/floor-plan/types";

const creation = vi.hoisted(() => ({
  deferred: false,
  completions: [] as (() => void)[],
}));
beforeEach(() => {
  creation.deferred = false;
  creation.completions = [];
});

vi.mock("@/features/admin/components/space-form", () => ({
  SpaceForm: ({
    floorId,
    canManage,
    onSaved,
  }: {
    floorId: string;
    canManage: boolean;
    onSaved: (data: { spaceId: string }) => void;
  }) => (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!canManage) return;
        const complete = () => onSaved({ spaceId: planEditorIds.spaceC });
        if (creation.deferred) creation.completions.push(complete);
        else complete();
      }}
    >
      <button type="submit" disabled={!canManage} data-floor-id={floorId}>
        가짜 공간 저장
      </button>
    </form>
  ),
}));

type Properties = ComponentProps<typeof EditorProperties>;
function panel(overrides: Partial<Properties> = {}) {
  const data = planEditorFixture();
  const callbacks = {
    onCommand: vi.fn(),
    onSelect: vi.fn(),
    onConnect: vi.fn(),
    onCreatePolygon: vi.fn(),
    onSnap: vi.fn(),
  };
  function Harness() {
    const [document, setDocument] = useState(
      overrides.document ?? planEditorDocument(),
    );
    const [snap, setSnap] = useState(true);
    return (
      <>
        <EditorProperties
          branchId={data.branch.id}
          floorId={data.floor.id}
          spaces={data.spaces}
          issues={[]}
          validationPending={false}
          selectedIds={[]}
          tool="select"
          {...callbacks}
          {...overrides}
          document={document}
          snap={snap}
          onCommand={(command) => {
            callbacks.onCommand(command);
            if (command) setDocument(command.apply);
          }}
          onSnap={(value) => {
            callbacks.onSnap(value);
            setSnap(value);
          }}
        />
        <pre hidden data-testid="document">
          {JSON.stringify(document)}
        </pre>
      </>
    );
  }
  return { ...render(<Harness />), ...callbacks };
}
const current = (): FloorPlanDocument =>
  JSON.parse(screen.getByTestId("document").textContent!);

describe("plan editor properties", () => {
  it("keeps floor size, snapping and issue controls labelled when nothing is selected", () => {
    panel();
    expect(screen.getByRole("heading", { name: "층 크기" })).toBeVisible();
    expect(
      screen.getByRole("spinbutton", { name: "층 너비 (mm)" }),
    ).toHaveValue(20000);
    expect(
      screen.getByRole("spinbutton", { name: "층 높이 (mm)" }),
    ).toHaveValue(14000);
    expect(
      screen.getByRole("switch", { name: "격자 스냅 100mm" }),
    ).toBeChecked();
    expect(screen.getByText("검사 문제가 없어요")).toBeVisible();
    expect(screen.queryByText("공간 정보")).not.toBeInTheDocument();
  });
  it("commits a number once on Enter, not again on blur or unchanged refocus", async () => {
    const user = userEvent.setup();
    const { onCommand } = panel({ selectedIds: ["space-a"] });
    const input = screen.getByRole("spinbutton", { name: "너비 (mm)" });
    await user.clear(input);
    await user.type(input, "5000");
    expect(onCommand).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");
    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(input).toHaveValue(5000);
    fireEvent.blur(input);
    await user.click(input);
    await user.tab();
    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(current().spaces[0]!.polygon[1]).toEqual([6000, 1000]);
    expect(current().spaces[0]!.label.at).toEqual([3500, 2500]);
  });
  it("commits once on focus leaving and preserves precise typed integer millimetres", async () => {
    const user = userEvent.setup();
    const { onCommand } = panel({ selectedIds: ["space-a"] });
    const input = screen.getByRole("spinbutton", { name: "X (mm)" });
    await user.clear(input);
    await user.type(input, "1234");
    await user.tab();
    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(current().spaces[0]!.polygon[0]).toEqual([1234, 1000]);
    expect(current().spaces[0]!.label.at).toEqual([3234, 2500]);
  });
  it.each(["", "1.5", "100000000000000000000"])(
    "rejects blank, fractional or unsafe numeric draft %s without a command",
    (value) => {
      const { onCommand } = panel({ selectedIds: ["space-a"] });
      const input = screen.getByRole("spinbutton", { name: "너비 (mm)" });
      fireEvent.change(input, { target: { value } });
      fireEvent.blur(input);
      expect(onCommand).not.toHaveBeenCalled();
      expect(input).toHaveValue(4000);
    },
  );
  it("rejects floor shrink beyond a fixture, then allows the exact containing boundary", async () => {
    const user = userEvent.setup();
    const { onCommand } = panel();
    const width = screen.getByRole("spinbutton", { name: "층 너비 (mm)" });
    await user.clear(width);
    await user.type(width, "16000{Enter}");
    expect(onCommand).not.toHaveBeenCalled();
    expect(current().bounds.w).toBe(20000);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "도형이 범위 밖으로 나가는 크기로는 바꿀 수 없어요",
    );
    await user.clear(width);
    await user.type(width, "17000{Enter}");
    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(current().bounds.w).toBe(17000);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("refuses rectangle geometry outside the floor and keeps the old shape", async () => {
    const user = userEvent.setup();
    const { onCommand } = panel({ selectedIds: ["space-a"] });
    const input = screen.getByRole("spinbutton", { name: "X (mm)" });
    await user.clear(input);
    await user.type(input, "19000{Enter}");
    expect(onCommand).not.toHaveBeenCalled();
    expect(input).toHaveValue(1000);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "범위와 입력을 확인해 주세요",
    );
  });
  it("moves labels to a strict interior corner and restores their integer center", async () => {
    const user = userEvent.setup();
    const { onCommand } = panel({ selectedIds: ["space-a"] });
    await user.click(screen.getByRole("button", { name: "왼쪽 위" }));
    expect(current().spaces[0]!.label.at).toEqual([1100, 1100]);
    expect(
      pointInPolygonStrict(
        current().spaces[0]!.label.at,
        current().spaces[0]!.polygon,
      ),
    ).toBe(true);
    await user.click(screen.getByRole("button", { name: "가운데" }));
    expect(current().spaces[0]!.label.at).toEqual([3000, 2500]);
    expect(onCommand).toHaveBeenCalledTimes(2);
  });
  it("shows read-only metadata, management link and space reconnect action", async () => {
    const user = userEvent.setup();
    const { onConnect } = panel({ selectedIds: ["space-a"] });
    expect(
      screen.getByText(/8인.*모니터.*화이트보드.*층 설정 따름/u),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "공간 관리에서 열기" }),
    ).toHaveAttribute(
      "href",
      `/admin/branches/${planEditorIds.branch}/floors/${planEditorIds.floor}`,
    );
    await user.click(screen.getByRole("button", { name: /회의실 6A/u }));
    expect(onConnect).toHaveBeenCalledWith("space-a");
    expect(
      screen.queryByRole("textbox", { name: "이름" }),
    ).not.toBeInTheDocument();
  });
  it("uses UUID identity rather than casing for connected space metadata", () => {
    const doc = planEditorDocument();
    doc.spaces[0]!.spaceId = planEditorIds.spaceA.toUpperCase();
    panel({ document: doc, selectedIds: ["space-a"] });
    expect(screen.getByRole("heading", { name: "공간 도형" })).toBeVisible();
    expect(screen.getByRole("button", { name: /회의실 6A/u })).toBeVisible();
  });
  it("shows fixtures without space-only metadata or label controls", async () => {
    const user = userEvent.setup();
    const { onCommand } = panel({ selectedIds: ["fixture-core"] });
    expect(screen.getByRole("heading", { name: "고정물" })).toBeVisible();
    expect(screen.getByRole("spinbutton", { name: "너비 (mm)" })).toHaveValue(
      2000,
    );
    expect(screen.queryByText("연결된 공간")).not.toBeInTheDocument();
    expect(screen.queryByText("라벨 위치")).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "선택한 도형 지우기" }),
    );
    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(current().fixtures).toEqual([]);
  });
  it("keeps an unknown space shape reconnectable instead of treating it as a fixture", async () => {
    const doc = planEditorDocument();
    doc.spaces[0]!.spaceId = planEditorIds.spaceC;
    const { onConnect } = panel({ document: doc, selectedIds: ["space-a"] });
    expect(screen.getByRole("heading", { name: "공간 도형" })).toBeVisible();
    await userEvent.click(
      screen.getByRole("button", { name: "연결된 공간 없음" }),
    );
    expect(onConnect).toHaveBeenCalledExactlyOnceWith("space-a");
    expect(screen.queryByText("공간 정보")).not.toBeInTheDocument();
  });
  it("does not show rectangle scalar fields for concave shapes", () => {
    const doc = planEditorDocument();
    doc.spaces[0]!.polygon = [
      [1000, 1000],
      [5000, 1000],
      [5000, 2000],
      [2000, 2000],
      [2000, 4000],
      [1000, 4000],
    ];
    panel({ document: doc, selectedIds: ["space-a"] });
    expect(
      screen.queryByRole("spinbutton", { name: "X (mm)" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "가운데" })).toBeVisible();
    expect(screen.getByText("면적 6.0m²")).toBeVisible();
  });
  it("aligns multiple shapes with one command and deletes the full selection with one more", async () => {
    const user = userEvent.setup();
    const { onCommand } = panel({ selectedIds: ["space-a", "space-b"] });
    expect(screen.getByRole("heading", { name: "도형 2개" })).toBeVisible();
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "왼쪽" }));
    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(current().spaces[1]!.polygon[0]).toEqual([1000, 5000]);
    await user.click(
      screen.getByRole("button", { name: "선택한 도형 지우기" }),
    );
    expect(onCommand).toHaveBeenCalledTimes(2);
    expect(current().spaces).toEqual([]);
    expect(current().fixtures).toHaveLength(1);
  });
  it("toggles snap by keyboard and blocks editing when disabled", async () => {
    const user = userEvent.setup();
    const { onSnap } = panel();
    const control = screen.getByRole("switch", { name: "격자 스냅 100mm" });
    control.focus();
    await user.keyboard(" ");
    expect(onSnap).toHaveBeenCalledExactlyOnceWith(false);
    expect(control).not.toBeChecked();
    expect(control).toHaveFocus();
  });
  it("disables every mutation control while stale but keeps issue navigation", () => {
    panel({
      selectedIds: ["space-a"],
      disabled: true,
      issues: [
        {
          code: "LABEL_OUTSIDE",
          shapeId: "space-a",
          message: "라벨 위치를 확인해 주세요.",
        },
      ],
    });
    for (const input of screen.getAllByRole("spinbutton"))
      expect(input).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "선택한 도형 지우기" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "보기" })).toBeEnabled();
    expect(screen.getByRole("switch")).toBeDisabled();
  });
  it("displays repeated same-shape issues without duplicate keys and selects their shape", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const user = userEvent.setup();
      const { onSelect } = panel({
        issues: [
          {
            code: "SPACE_OVERLAP",
            shapeId: "space-b",
            message: "세미나실: 회의실 A 도형과 겹쳐요.",
          },
          {
            code: "SPACE_OVERLAP",
            shapeId: "space-b",
            message: "세미나실: 코어 도형과 겹쳐요.",
          },
          { code: "SHAPE_MISSING", message: "라운지: 연결된 도형이 없어요." },
        ],
      });
      expect(
        screen.getByRole("heading", { name: "검사 문제 3" }),
      ).toBeVisible();
      expect(screen.getAllByRole("button", { name: "보기" })).toHaveLength(2);
      await user.click(screen.getAllByRole("button", { name: "보기" })[1]!);
      expect(onSelect).toHaveBeenCalledExactlyOnceWith(["space-b"]);
      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });
  it("shows pending validation as loading rather than an empty result", () => {
    panel({ validationPending: true });
    expect(screen.getByRole("status")).toHaveTextContent(
      "도형을 검사하고 있어요",
    );
    expect(screen.queryByText("검사 문제가 없어요")).not.toBeInTheDocument();
  });
  it("provides keyboard-only rectangle and polygon creation without mutating until connection", async () => {
    const user = userEvent.setup();
    const view = panel({ tool: "rectangle" });
    await user.click(screen.getByText("숫자로 사각형 만들기"));
    await user.clear(screen.getByRole("spinbutton", { name: "시작 X" }));
    await user.type(
      screen.getByRole("spinbutton", { name: "시작 X" }),
      "1000{Enter}",
    );
    await user.click(
      screen.getByRole("button", { name: "사각형 도형 만들기" }),
    );
    expect(view.onCreatePolygon).toHaveBeenCalledExactlyOnceWith([
      [1000, 0],
      [4000, 0],
      [4000, 3000],
      [1000, 3000],
    ]);
    expect(view.onCommand).not.toHaveBeenCalled();
    view.unmount();
    const polygon = panel({ tool: "polygon" });
    await user.click(screen.getByText("숫자로 다각형 만들기"));
    const create = screen.getByRole("button", { name: "다각형 도형 만들기" });
    expect(create).toBeDisabled();
    for (const [x, y] of [
      [0, 0],
      [2000, 0],
      [1000, 1000],
    ]) {
      const xi = screen.getByRole("spinbutton", { name: "꼭짓점 X" });
      const yi = screen.getByRole("spinbutton", { name: "꼭짓점 Y" });
      await user.clear(xi);
      await user.type(xi, `${x}{Enter}`);
      await user.clear(yi);
      await user.type(yi, `${y}{Enter}`);
      await user.click(screen.getByRole("button", { name: "꼭짓점 더하기" }));
    }
    expect(create).toBeEnabled();
    await user.click(create);
    expect(polygon.onCreatePolygon).toHaveBeenCalledExactlyOnceWith([
      [0, 0],
      [2000, 0],
      [1000, 1000],
    ]);
    expect(polygon.onCommand).not.toHaveBeenCalled();
    expect(screen.getByText("꼭짓점 0개")).toBeVisible();
  });
});

describe("plan editor connection dialog", () => {
  function focusHarness({ removeOpener = false, hideOnClose = false } = {}) {
    const bounds = vi
      .spyOn(HTMLElement.prototype, "getClientRects")
      .mockImplementation(function (this: HTMLElement) {
        const rects = this.closest("[hidden], [inert]")
          ? []
          : [new DOMRect(0, 0, 44, 44)];
        return Object.assign(rects, {
          item: (index: number) => rects[index] ?? null,
        });
      });
    function Harness() {
      const [open, setOpen] = useState(false);
      const [finished, setFinished] = useState(false);
      const close = () => {
        setOpen(false);
        setFinished(true);
      };
      return (
        <>
          <button>다른 화면 버튼</button>
          <div
            data-editor-canvas
            tabIndex={0}
            aria-label="다른 편집기 캔버스"
          />
          <main hidden={hideOnClose && finished}>
            {!(removeOpener && finished) && (
              <button onClick={() => setOpen(true)}>연결 창 열기</button>
            )}
            <div
              data-editor-canvas
              tabIndex={0}
              aria-label="현재 편집기 캔버스"
            />
            {open && (
              <EditorConnectDialog
                data={planEditorFixture()}
                document={{ ...planEditorDocument(), spaces: [] }}
                onClose={close}
                onSpace={close}
                onFixture={close}
              />
            )}
          </main>
        </>
      );
    }
    return { ...render(<Harness />), bounds };
  }
  function dialog(
    overrides: Partial<ComponentProps<typeof EditorConnectDialog>> = {},
  ) {
    const data = planEditorFixture();
    data.spaces.push({
      ...data.spaces[0]!,
      id: planEditorIds.spaceC,
      name: "라운지",
      type: "lounge",
      bookable: false,
    });
    const callbacks = {
      onClose: vi.fn(),
      onSpace: vi.fn(),
      onFixture: vi.fn(),
    };
    return {
      ...render(
        <EditorConnectDialog
          data={data}
          document={planEditorDocument()}
          {...callbacks}
          {...overrides}
        />,
      ),
      ...callbacks,
    };
  }
  it("offers only unlinked active non-desk spaces on the current floor", async () => {
    const data = planEditorFixture();
    data.spaces.push(
      { ...data.spaces[0]!, id: planEditorIds.spaceC, name: "선택할 공간" },
      { ...data.spaces[0]!, id: "foreign", floorId: "other", name: "다른 층" },
      { ...data.spaces[0]!, id: "archived", archived: true, name: "보관 공간" },
      { ...data.spaces[0]!, id: "desk", type: "desk", name: "좌석" },
    );
    const { onSpace } = dialog({ data });
    for (const name of [
      "회의실 6A",
      "세미나실",
      "다른 층",
      "보관 공간",
      "좌석",
    ])
      expect(
        screen.queryByRole("button", { name: new RegExp(name, "u") }),
      ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /선택할 공간/u }));
    expect(onSpace).toHaveBeenCalledExactlyOnceWith(planEditorIds.spaceC);
  });
  it("treats uppercase linked UUIDs as already used", () => {
    const doc = planEditorDocument();
    doc.spaces[0]!.spaceId = planEditorIds.spaceA.toUpperCase();
    dialog({ document: doc });
    expect(
      screen.queryByRole("button", { name: /회의실 6A/u }),
    ).not.toBeInTheDocument();
  });
  it("allows reconnecting the current shape to its own space but not converting it to a fixture", () => {
    dialog({ replaceShapeId: "space-a" });
    expect(screen.getByRole("button", { name: /회의실 6A/u })).toBeVisible();
    expect(screen.queryByText("고정물로 두기")).not.toBeInTheDocument();
  });
  it.each(["close", "escape"] as const)(
    "closing by %s never creates a shape",
    async (method) => {
      const user = userEvent.setup();
      const { onClose, onSpace, onFixture } = dialog();
      if (method === "close")
        await user.click(screen.getByRole("button", { name: "닫기" }));
      else await user.keyboard("{Escape}");
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(onSpace).not.toHaveBeenCalled();
      expect(onFixture).not.toHaveBeenCalled();
    },
  );
  it.each([
    ["코어", "core"],
    ["계단", "stairs"],
    ["창고", "storage"],
  ] as const)("can choose %s without a DB space", async (label, kind) => {
    const { onFixture, onSpace } = dialog();
    await userEvent.click(screen.getByRole("button", { name: label }));
    expect(onFixture).toHaveBeenCalledExactlyOnceWith(kind);
    expect(onSpace).not.toHaveBeenCalled();
  });
  it("hides new-space management without permission", () => {
    const data = planEditorFixture();
    data.canManageSpaces = false;
    dialog({ data });
    expect(
      screen.queryByRole("button", { name: "새 공간 만들기" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("연결할 공간이 없어요")).toBeVisible();
    expect(screen.getByRole("button", { name: "코어" })).toBeEnabled();
  });
  it("uses the existing space form's {spaceId} result and current floor, with a route back", async () => {
    const user = userEvent.setup();
    const { onSpace } = dialog();
    await user.click(screen.getByRole("button", { name: "새 공간 만들기" }));
    expect(screen.getByRole("dialog")).toHaveAccessibleName("새 공간 만들기");
    const save = screen.getByRole("button", { name: "가짜 공간 저장" });
    expect(save).toHaveAttribute("data-floor-id", planEditorIds.floor);
    await user.click(save);
    expect(onSpace).toHaveBeenCalledExactlyOnceWith(planEditorIds.spaceC);
    await user.click(screen.getByRole("button", { name: "목록으로" }));
    expect(screen.getByRole("dialog")).toHaveAccessibleName(
      "연결할 공간 고르기",
    );
  });
  it.each(["close", "escape", "space", "fixture"] as const)(
    "restores the invoking control after %s without a DialogTrigger",
    async (method) => {
      const app = focusHarness();
      try {
        const user = userEvent.setup();
        const opener = screen.getByRole("button", { name: "연결 창 열기" });
        await user.click(opener);
        if (method === "escape") await user.keyboard("{Escape}");
        else
          await user.click(
            screen.getByRole("button", {
              name:
                method === "close"
                  ? "닫기"
                  : method === "space"
                    ? /회의실 6A/u
                    : "코어",
            }),
          );
        await waitFor(() => expect(opener).toHaveFocus());
      } finally {
        app.bounds.mockRestore();
      }
    },
  );
  it("returns to the same editor canvas when connecting removes the invoking control", async () => {
    const app = focusHarness({ removeOpener: true });
    try {
      await userEvent.click(
        screen.getByRole("button", { name: "연결 창 열기" }),
      );
      await userEvent.click(screen.getByRole("button", { name: /회의실 6A/u }));
      await waitFor(() =>
        expect(screen.getByLabelText("현재 편집기 캔버스")).toHaveFocus(),
      );
      expect(screen.getByLabelText("다른 편집기 캔버스")).not.toHaveFocus();
    } finally {
      app.bounds.mockRestore();
    }
  });
  it("does not restore focus to a hidden retained editor", async () => {
    const app = focusHarness({ hideOnClose: true });
    try {
      await userEvent.click(
        screen.getByRole("button", { name: "연결 창 열기" }),
      );
      await userEvent.click(screen.getByRole("button", { name: "닫기" }));
      const outside = screen.getByRole("button", { name: "다른 화면 버튼" });
      outside.focus();
      await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
      expect(outside).toHaveFocus();
    } finally {
      app.bounds.mockRestore();
    }
  });
  it("connects a deferred successful creation once while its form remains active", async () => {
    creation.deferred = true;
    const { onSpace } = dialog();
    await userEvent.click(
      screen.getByRole("button", { name: "새 공간 만들기" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "가짜 공간 저장" }),
    );
    expect(onSpace).not.toHaveBeenCalled();
    act(() => creation.completions[0]!());
    expect(onSpace).toHaveBeenCalledExactlyOnceWith(planEditorIds.spaceC);
    act(() => creation.completions[0]!());
    expect(onSpace).toHaveBeenCalledTimes(1);
  });
  it("discards the old creation after returning to the list and accepts a fresh form submission", async () => {
    creation.deferred = true;
    const { onSpace } = dialog();
    await userEvent.click(
      screen.getByRole("button", { name: "새 공간 만들기" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "가짜 공간 저장" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "목록으로" }));
    await userEvent.click(
      screen.getByRole("button", { name: "새 공간 만들기" }),
    );
    act(() => creation.completions[0]!());
    expect(onSpace).not.toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole("button", { name: "가짜 공간 저장" }),
    );
    act(() => creation.completions[1]!());
    expect(onSpace).toHaveBeenCalledExactlyOnceWith(planEditorIds.spaceC);
  });
  it("discards a late creation when narrowing the workspace unmounts the dialog", async () => {
    creation.deferred = true;
    const onSpace = vi.fn();
    const data = planEditorFixture();
    const content = (wide: boolean) =>
      wide ? (
        <EditorConnectDialog
          data={data}
          document={planEditorDocument()}
          onSpace={onSpace}
          onClose={vi.fn()}
          onFixture={vi.fn()}
        />
      ) : (
        <p>좁은 화면 안내</p>
      );
    const app = render(content(true));
    await userEvent.click(
      screen.getByRole("button", { name: "새 공간 만들기" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "가짜 공간 저장" }),
    );
    app.rerender(content(false));
    act(() => creation.completions[0]!());
    expect(onSpace).not.toHaveBeenCalled();
    expect(screen.getByText("좁은 화면 안내")).toBeVisible();
  });
  it.each([false, true])(
    "discards a pre-Activity creation when resumed=%s",
    async (resumed) => {
      creation.deferred = true;
      const onSpace = vi.fn();
      const data = planEditorFixture();
      const content = (hidden: boolean) => (
        <Activity mode={hidden ? "hidden" : "visible"}>
          <EditorConnectDialog
            data={data}
            document={planEditorDocument()}
            onSpace={onSpace}
            onClose={vi.fn()}
            onFixture={vi.fn()}
          />
        </Activity>
      );
      const app = render(content(false));
      await userEvent.click(
        screen.getByRole("button", { name: "새 공간 만들기" }),
      );
      await userEvent.click(
        screen.getByRole("button", { name: "가짜 공간 저장" }),
      );
      app.rerender(content(true));
      if (resumed) app.rerender(content(false));
      act(() => creation.completions[0]!());
      expect(onSpace).not.toHaveBeenCalled();
      if (resumed) {
        await userEvent.click(
          screen.getByRole("button", { name: "가짜 공간 저장" }),
        );
        act(() => creation.completions[1]!());
        expect(onSpace).toHaveBeenCalledExactlyOnceWith(planEditorIds.spaceC);
      }
    },
  );
});

describe("plan editor frame", () => {
  it("keeps the desktop frame fixed and marks narrow-screen guidance without rendering future tools", () => {
    const { container } = render(
      <PlanEditorFrame
        heading="가상 강남점 6F"
        panel={<p>패널</p>}
        toolbar={<button>선택 (V)</button>}
      >
        도면
      </PlanEditorFrame>,
    );
    expect(screen.getByRole("main")).toHaveClass("h-dvh", "overflow-hidden");
    expect(container.querySelector("header")).toHaveClass("shrink-0");
    expect(
      screen.getByText("평면도 편집은 1024px 이상 화면에서 할 수 있어요")
        .parentElement,
    ).toHaveClass("lg:hidden");
    expect(
      screen.getByRole("complementary", { name: "도형 속성" }),
    ).toHaveClass("w-80", "overflow-y-auto");
    expect(
      within(
        screen.getByRole("navigation", { name: "평면도 도구" }),
      ).getAllByRole("button"),
    ).toHaveLength(1);
    expect(
      screen.queryByRole("button", { name: /좌석 배열|벽|문|축척|게시/u }),
    ).not.toBeInTheDocument();
  });
  it("keeps panel headings visible while only unknown data is a skeleton", () => {
    render(<PlanEditorSkeleton />);
    expect(screen.getByRole("heading", { name: "도형 속성" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "검사 문제" })).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(
      "평면도를 불러오고 있어요",
    );
  });
});
