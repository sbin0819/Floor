import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SeatMap, type SeatMapItem } from "@/components/seat-map";

const seats: SeatMapItem[] = [
  { id: "a", name: "A-01", row: 0, column: 0, state: "free" },
  { id: "b", name: "A-02", row: 0, column: 1, state: "booked" },
  { id: "c", name: "A-03", row: 0, column: 2, state: "mine" },
  { id: "d", name: "A-04", row: 1, column: 0, state: "blocked" },
  { id: "e", name: "A-05", row: 1, column: 1, state: "unavailable" },
];
describe("SeatMap", () => {
  it("keeps one tab stop and explains every unavailable seat without disabling its focus", async () => {
    const onSelect = vi.fn();
    render(<SeatMap seats={seats} selectedId={null} onSelect={onSelect} />);
    const buttons = within(
      screen.getByRole("group", { name: "좌석 배치도" }),
    ).getAllByRole("button");
    expect(buttons.filter((button) => button.tabIndex === 0)).toHaveLength(1);
    for (const button of buttons)
      expect(button).toHaveClass("h-11", "min-w-11");
    for (const label of [
      "A-02, 예약됨",
      "A-04, 점검",
      "A-05, 예약할 수 없는 자리",
    ]) {
      const button = screen.getByRole("button", { name: label });
      expect(button).not.toBeDisabled();
      expect(button).toHaveAttribute("aria-disabled", "true");
      await userEvent.click(button);
      expect(button).toHaveFocus();
    }
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByLabelText("좌석 상태 범례")).toHaveTextContent(
      "내 자리",
    );
  });
  it("toggles only free or own seats and never owns duplicate selection state", async () => {
    function Controlled() {
      const [selected, setSelected] = useState<string | null>(null);
      return (
        <SeatMap seats={seats} selectedId={selected} onSelect={setSelected} />
      );
    }
    render(<Controlled />);
    const first = screen.getByRole("button", { name: "A-01, 비어 있음" });
    await userEvent.click(first);
    expect(first).toHaveAttribute("aria-pressed", "true");
    await userEvent.keyboard(" ");
    expect(first).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(
      screen.getByRole("button", { name: "A-03, 내 자리" }),
    );
    expect(screen.getAllByRole("button", { pressed: true })).toHaveLength(1);
    await userEvent.keyboard("{Enter}");
    expect(screen.queryAllByRole("button", { pressed: true })).toHaveLength(0);
  });
  it("moves by rows, clamps a short row and supports Home/End", async () => {
    render(<SeatMap seats={seats} selectedId={null} onSelect={vi.fn()} />);
    await userEvent.tab();
    await userEvent.keyboard("{End}");
    expect(screen.getByRole("button", { name: "A-03, 내 자리" })).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    expect(
      screen.getByRole("button", { name: "A-05, 예약할 수 없는 자리" }),
    ).toHaveFocus();
    await userEvent.keyboard("{Home}{ArrowUp}{ArrowRight}");
    expect(screen.getByRole("button", { name: "A-02, 예약됨" })).toHaveFocus();
    expect(
      screen.getAllByRole("button").filter((button) => button.tabIndex === 0),
    ).toHaveLength(1);
  });
  it("allows internal horizontal scrolling while keeping 40 seats at least 44px", () => {
    const many = Array.from({ length: 40 }, (_, index): SeatMapItem => ({
      id: `${index}`,
      name: `B-${index + 1}`,
      row: Math.floor(index / 10),
      column: index % 10,
      state: "free",
    }));
    render(<SeatMap seats={many} selectedId={null} onSelect={vi.fn()} />);
    const map = screen.getByRole("group", { name: "좌석 배치도" });
    expect(map).toHaveClass("overflow-auto");
    expect(map.firstElementChild).toHaveStyle({ minWidth: "512px" });
    expect(within(map).getAllByRole("button")).toHaveLength(40);
    fireEvent.keyDown(within(map).getAllByRole("button")[0]!, {
      key: "ArrowLeft",
    });
    expect(within(map).getAllByRole("button")[0]).toHaveFocus();
  });
});
