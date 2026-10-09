import { Activity, useState, type ComponentProps } from "react";
import { renderToString } from "react-dom/server";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PlanAccessibility } from "@/features/floor-plan/components/plan-accessibility";
import type {
  PlanScene,
  PlanShapeState,
  PlanStates,
  PolygonShape,
} from "@/lib/floor-plan/render/types";

const shape = (
  id: string,
  x: number,
  y: number,
  order: number,
  kind: PolygonShape["kind"] = "space",
): PolygonShape => ({
  id,
  spaceId: `space-${id}`,
  kind,
  labelAt: [x, y],
  bounds: { minX: x - 100, minY: y - 100, maxX: x + 100, maxY: y + 100 },
  points: [
    [x - 100, y - 100],
    [x + 100, y - 100],
    [x, y + 100],
  ],
  order,
});
const a = shape("a", 1000, 1000, 0);
const b = shape("b", 5000, 1000, 1);
const c = shape("c", 1000, 5000, 2);
const restricted = shape("restricted", 3000, 1000, 3);
const scene: PlanScene = {
  bounds: { w: 10000, h: 10000 },
  shapes: [
    c,
    b,
    restricted,
    a,
    shape("seat", 100, 100, 4, "seat"),
    shape("fixture", 100, 100, 5, "fixture"),
    shape("unknown", 100, 100, 6),
  ],
};
const states: PlanStates = new Map([
  [
    a.spaceId!,
    { kind: "free", name: "회의실 A", label: "6인 · 14:00까지 비어 있음" },
  ],
  [
    b.spaceId!,
    { kind: "booked", name: "회의실 B", label: "8인 · 13:00까지 예약됨" },
  ],
  [
    c.spaceId!,
    {
      kind: "maintenance",
      name: "회의실 C",
      label: "점검 중 · 내일 12:00까지",
    },
  ],
  [
    restricted.spaceId!,
    {
      kind: "restricted",
      name: "노출하면 안 되는 공간 이름",
      label: "다른 사람 예약 제목",
    },
  ],
  ["space-seat", { kind: "free", name: "좌석 이름" }],
  ["space-fixture", { kind: "neutral", name: "고정물" }],
]);
type Props = ComponentProps<typeof PlanAccessibility>;
function Harness(props: Partial<Props>) {
  const [lastFocusedId, setLastFocusedId] = useState(
    props.lastFocusedId ?? null,
  );
  return (
    <>
      <button type="button">목록 앞</button>
      <PlanAccessibility
        scene={scene}
        states={states}
        lastFocusedId={lastFocusedId}
        timeLabel="11:30 기준"
        onSelect={() => {}}
        onClear={() => {}}
        {...props}
        onFocus={(target) => {
          if (target) setLastFocusedId(target.id);
          props.onFocus?.(target);
        }}
      />
      <button type="button">목록 뒤</button>
    </>
  );
}
const list = () => screen.getByRole("list", { name: "평면도 공간 목록" });
const space = (name: string) =>
  within(list()).getByRole("button", { name: new RegExp(name) });
function changedState(id: string, change: Partial<PlanShapeState>): PlanStates {
  const next = new Map(states);
  next.set(id, { ...next.get(id)!, ...change });
  return next;
}

describe("floor plan screen-reader and keyboard controls", () => {
  it("renders a visually hidden list in reading order with just one entry tab stop", () => {
    render(<Harness />);
    expect(list()).toHaveClass("sr-only");
    expect(
      within(list())
        .getAllByRole("button")
        .map((button) => button.dataset.planShapeId),
    ).toEqual(["a", "restricted", "b", "c"]);
    expect(list().querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    expect(space("회의실 A")).toHaveAttribute("tabindex", "0");
    expect(space("회의실 A")).toHaveAccessibleName(
      "회의실 A, 11:30 기준, 6인 · 14:00까지 비어 있음",
    );
    expect(list()).not.toHaveTextContent("좌석 이름");
    expect(list()).not.toHaveTextContent("고정물");
  });
  it("never exposes restricted state names and uses a native disabled button", async () => {
    const select = vi.fn();
    render(<Harness onSelect={select} />);
    const unavailable = within(list()).getByRole("button", {
      name: "전용 공간, 고를 수 없음",
    });
    expect(unavailable).toBeDisabled();
    expect(unavailable).toHaveAttribute("tabindex", "-1");
    expect(list()).not.toHaveTextContent("노출하면 안 되는");
    expect(list()).not.toHaveTextContent("다른 사람 예약 제목");
    await userEvent.click(unavailable);
    expect(select).not.toHaveBeenCalled();
  });
  it("visits the plan once in Tab order and remembers the last focused space on reentry", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.tab();
    expect(screen.getByRole("button", { name: "목록 앞" })).toHaveFocus();
    await user.tab();
    expect(space("회의실 A")).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(space("회의실 B")).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "목록 뒤" })).toHaveFocus();
    await user.tab({ shift: true });
    expect(space("회의실 B")).toHaveFocus();
    expect(list().querySelectorAll('[tabindex="0"]')).toHaveLength(1);
  });
  it("uses all four directions, skips restricted targets, and does not wrap at the edge", async () => {
    const user = userEvent.setup();
    const selected = vi.fn();
    render(<Harness onSelect={selected} />);
    act(() => space("회의실 A").focus());
    await user.keyboard("{ArrowLeft}{ArrowUp}");
    expect(space("회의실 A")).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(space("회의실 B")).toHaveFocus();
    await user.keyboard("{ArrowLeft}{ArrowDown}");
    expect(space("회의실 C")).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(space("회의실 A")).toHaveFocus();
    expect(selected).not.toHaveBeenCalled();
  });
  it("uses native Enter and Space activation exactly once each", async () => {
    const user = userEvent.setup();
    const select = vi.fn();
    render(<Harness onSelect={select} />);
    act(() => space("회의실 A").focus());
    await user.keyboard("{Enter}");
    expect(select).toHaveBeenCalledExactlyOnceWith(a);
    await user.keyboard(" ");
    expect(select).toHaveBeenCalledTimes(2);
    expect(select).toHaveBeenLastCalledWith(a);
  });
  it("clears selection on Escape without moving focus or submitting a containing form", async () => {
    const user = userEvent.setup();
    const clear = vi.fn();
    const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(
      <form onSubmit={submit}>
        <Harness onClear={clear} />
      </form>,
    );
    act(() => space("회의실 A").focus());
    await user.keyboard("{Escape}");
    expect(clear).toHaveBeenCalledOnce();
    expect(space("회의실 A")).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(submit).not.toHaveBeenCalled();
  });
  it("reports the focused shape for the canvas ring and null only when leaving the list", async () => {
    const user = userEvent.setup();
    const focus = vi.fn();
    render(<Harness onFocus={focus} />);
    act(() => space("회의실 A").focus());
    await user.keyboard("{ArrowRight}");
    expect(focus.mock.calls.map(([target]) => target?.id ?? null)).toEqual([
      "a",
      "b",
    ]);
    await user.tab();
    expect(focus).toHaveBeenLastCalledWith(null);
  });
  it("updates time and status labels without recreating the focused button or resetting the tab stop", () => {
    const { rerender } = render(<Harness />);
    const button = space("회의실 B");
    act(() => button.focus());
    rerender(
      <Harness
        timeLabel="14:00 기준"
        states={changedState(b.spaceId!, {
          kind: "free",
          label: "8인 · 18:00까지 비어 있음",
        })}
      />,
    );
    expect(space("회의실 B")).toBe(button);
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute("tabindex", "0");
    expect(button).toHaveAccessibleName(
      "회의실 B, 14:00 기준, 8인 · 18:00까지 비어 있음",
    );
  });
  it("restores the supplied last focused target but does not autofocus on mount", async () => {
    const user = userEvent.setup();
    render(<Harness lastFocusedId="c" />);
    expect(document.body).toHaveFocus();
    await user.tab();
    await user.tab();
    expect(space("회의실 C")).toHaveFocus();
  });
  it.each(["missing", "restricted"])(
    "falls back to the first available tab stop for an invalid previous target: %s",
    (id) => {
      render(<Harness lastFocusedId={id} />);
      expect(space("회의실 A")).toHaveAttribute("tabindex", "0");
      expect(list().querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    },
  );
  it("moves focus to a valid target if the focused shape disappears", () => {
    const { rerender } = render(<Harness />);
    act(() => space("회의실 B").focus());
    rerender(
      <Harness
        scene={{
          ...scene,
          shapes: scene.shapes.filter(({ id }) => id !== "b"),
        }}
      />,
    );
    expect(space("회의실 A")).toHaveFocus();
    expect(space("회의실 A")).toHaveAttribute("tabindex", "0");
  });
  it("moves focus away from a target whose access is removed", () => {
    const { rerender } = render(<Harness />);
    act(() => space("회의실 B").focus());
    rerender(
      <Harness states={changedState(b.spaceId!, { kind: "restricted" })} />,
    );
    expect(space("회의실 A")).toHaveFocus();
    expect(
      within(list()).getAllByRole("button", {
        name: "전용 공간, 고를 수 없음",
      }),
    ).toHaveLength(2);
  });
  it("does not steal external focus when the previous target disappears", () => {
    const focus = vi.fn();
    const { rerender } = render(<Harness onFocus={focus} />);
    act(() => space("회의실 B").focus());
    const outside = screen.getByRole("button", { name: "목록 뒤" });
    act(() => outside.focus());
    focus.mockClear();
    rerender(<Harness onFocus={focus} scene={{ ...scene, shapes: [a] }} />);
    expect(outside).toHaveFocus();
    expect(focus).not.toHaveBeenCalled();
  });
  it("keeps the previous tab stop across Activity hiding without taking focus on restore", () => {
    const view = (mode: "visible" | "hidden") => (
      <>
        <Activity mode={mode}>
          <Harness />
        </Activity>
        <button type="button">다른 화면</button>
      </>
    );
    const { rerender } = render(view("visible"));
    act(() => space("회의실 B").focus());
    rerender(view("hidden"));
    const otherScreen = screen.getByRole("button", { name: "다른 화면" });
    act(() => otherScreen.focus());
    rerender(view("visible"));
    expect(otherScreen).toHaveFocus();
    expect(space("회의실 B")).toHaveAttribute("tabindex", "0");
  });
  it("excludes filtered spaces and removes the canvas ring when no available targets remain", () => {
    const focus = vi.fn();
    const { rerender } = render(<Harness onFocus={focus} />);
    act(() => space("회의실 B").focus());
    rerender(
      <Harness
        onFocus={focus}
        states={
          new Map([
            [restricted.spaceId!, states.get(restricted.spaceId!)!],
            [b.spaceId!, { ...states.get(b.spaceId!)!, hidden: true }],
          ])
        }
      />,
    );
    expect(within(list()).getAllByRole("button")).toHaveLength(1);
    expect(list().querySelector('[tabindex="0"]')).toBeNull();
    expect(focus).toHaveBeenLastCalledWith(null);
  });
  it("reflects controlled selection separately from keyboard focus", () => {
    const { rerender } = render(<Harness selectedSpaceId={b.spaceId} />);
    expect(space("회의실 B")).toHaveAttribute("aria-pressed", "true");
    act(() => space("회의실 A").focus());
    expect(space("회의실 B")).toHaveAttribute("aria-pressed", "true");
    rerender(<Harness selectedSpaceId={null} />);
    expect(space("회의실 B")).toHaveAttribute("aria-pressed", "false");
    expect(space("회의실 A")).toHaveFocus();
  });
  it("leaves modified arrow keys and text composition alone", () => {
    const clear = vi.fn();
    render(<Harness onClear={clear} />);
    const first = space("회의실 A");
    act(() => first.focus());
    expect(fireEvent.keyDown(first, { key: "ArrowRight", ctrlKey: true })).toBe(
      true,
    );
    expect(fireEvent.keyDown(first, { key: "ArrowRight", altKey: true })).toBe(
      true,
    );
    expect(fireEvent.keyDown(first, { key: "ArrowRight", metaKey: true })).toBe(
      true,
    );
    expect(fireEvent.keyDown(first, { key: "Escape", isComposing: true })).toBe(
      true,
    );
    expect(clear).not.toHaveBeenCalled();
    expect(first).toHaveFocus();
  });
  it("renders server markup without browser-only APIs and handles an empty scene", () => {
    const props = {
      scene,
      states,
      lastFocusedId: null,
      timeLabel: "11:30 기준",
      onFocus: vi.fn(),
      onSelect: vi.fn(),
      onClear: vi.fn(),
    };
    const html = renderToString(<PlanAccessibility {...props} />);
    expect(html).toContain("평면도 공간 목록");
    expect(html).not.toContain("노출하면 안 되는");
    render(<PlanAccessibility {...props} scene={{ ...scene, shapes: [] }} />);
    expect(within(list()).queryByRole("button")).toBeNull();
  });
});
