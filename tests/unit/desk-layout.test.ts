import { describe, expect, it } from "vitest";
import { arrangeDesks } from "@/features/bookings/desk-layout";
import plan from "@/docs/spec/examples/gangnam-7f.plan.json";
import spaces from "@/docs/spec/examples/gangnam-7f.spaces.json";
import type { FloorPlanDocument } from "@/lib/floor-plan/types";

const position = (
  id: string,
  x: number,
  y: number,
  height = 700,
): FloorPlanDocument["seats"][number] => ({
  id,
  spaceId: id,
  at: [x, y],
  size: [1400, height],
  rotation: 90,
});
describe("desk row and column arrangement", () => {
  it("uses the published fixture as four rows of six seats", () => {
    const desks = spaces.spaces.filter(({ type }) => type === "desk");
    const arranged = arrangeDesks(
      desks,
      plan.seats as FloorPlanDocument["seats"],
    );
    expect(arranged).toHaveLength(24);
    expect(arranged.find(({ name }) => name === "A-01")).toMatchObject({
      row: 0,
      column: 0,
    });
    expect(arranged.find(({ name }) => name === "A-24")).toMatchObject({
      row: 3,
      column: 5,
    });
    expect(
      Array.from(
        { length: 4 },
        (_, row) => arranged.filter((seat) => seat.row === row).length,
      ),
    ).toEqual([6, 6, 6, 6]);
  });
  it("uses each row's first seat rather than chaining nearby y values and ignores rotation", () => {
    const desks = ["a", "b", "c", "d"].map((id) => ({ id, name: id }));
    const result = arrangeDesks(desks, [
      position("a", 200, 0),
      position("b", 100, 350),
      position("c", 100, 351),
      position("d", 300, 650),
    ]);
    expect(result).toEqual([
      { id: "b", name: "b", row: 0, column: 0 },
      { id: "a", name: "a", row: 0, column: 1 },
      { id: "c", name: "c", row: 1, column: 0 },
      { id: "d", name: "d", row: 1, column: 1 },
    ]);
  });
  it("appends missing positions in numeric name order, six per row", () => {
    const desks = [10, 2, 1, 5, 4, 3, 7, 6].map((n) => ({
      id: String(n),
      name: `A-${n}`,
    }));
    expect(
      arrangeDesks(desks, []).map(({ name, row, column }) => [
        name,
        row,
        column,
      ]),
    ).toEqual([
      ["A-1", 0, 0],
      ["A-2", 0, 1],
      ["A-3", 0, 2],
      ["A-4", 0, 3],
      ["A-5", 0, 4],
      ["A-6", 0, 5],
      ["A-7", 1, 0],
      ["A-10", 1, 1],
    ]);
    const result = arrangeDesks(desks, [position("10", 0, 0)]);
    expect(result[0]).toEqual({ id: "10", name: "A-10", row: 0, column: 0 });
    expect(result[1]).toEqual({ id: "1", name: "A-1", row: 1, column: 0 });
  });
});
