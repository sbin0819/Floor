import { describe, expect, it } from "vitest";
import {
  applySeatArrayCommand,
  inferSeatArray,
  previewSeatArray,
  seatLabels,
} from "@/features/floor-plan/editor/seat-array";
import {
  deleteShapesCommand,
  replaceSeatsCommand,
} from "@/features/floor-plan/editor/commands";
import {
  duplicateEditableShapesCommand,
  rotateSeatsCommand,
  setSeatCommand,
} from "@/features/floor-plan/editor/seat-commands";
import {
  alignShapesCommand,
  moveShapesCommand,
  resizeShapeCommand,
} from "@/features/floor-plan/editor/transforms";
import { floorPlanSchema } from "@/lib/floor-plan/schema";
import { editorStore } from "../helpers/plan-editor-store";
import {
  seatAreaId,
  seatDocument,
  seatRows,
  seatUuid,
} from "../helpers/plan-seat-array";

describe("seat array inference and commands", () => {
  it.each([true, false])(
    "infers the actual 7F origin and leaves a direct apply unchanged (hydrate=%s)",
    (hydrate) => {
      const document = seatDocument(hydrate);
      const initial = inferSeatArray(document, seatAreaId, seatRows)!;
      expect(initial.exact).toBe(true);
      expect(initial.settings).toEqual({
        rows: 4,
        columns: 6,
        width: 1400,
        depth: 700,
        gapX: 1400,
        gapY: 1300,
        rotation: 0,
        prefix: "A-",
        start: 1,
        origin: [1800, 10150],
      });
      const preview = previewSeatArray(
        document,
        seatAreaId,
        seatRows,
        initial.settings,
      );
      expect(preview).toMatchObject({
        changed: false,
        valid: true,
        newLabels: [],
        outsideCount: 0,
      });
      preview.seats.forEach((seat, index) =>
        expect(seat).toBe(document.seats[index]),
      );
      const store = editorStore(document);
      expect(
        store
          .getState()
          .execute(
            applySeatArrayCommand(
              document,
              seatAreaId,
              seatRows,
              initial.settings,
              new Map(),
            ),
          ),
      ).toBe(false);
      expect(store.getState()).toMatchObject({
        document,
        changeId: 0,
        undoStack: [],
      });
      expect(store.getState().document).toBe(document);
    },
  );
  it("5×6 at 1100mm adds exactly six ids, preserving existing bindings and one undo", () => {
    const document = seatDocument();
    const settings = {
      ...inferSeatArray(document, seatAreaId, seatRows)!.settings,
      rows: 5,
      gapY: 1100,
    };
    const preview = previewSeatArray(document, seatAreaId, seatRows, settings);
    expect(preview.valid).toBe(true);
    expect(preview.newLabels).toEqual([
      "A-25",
      "A-26",
      "A-27",
      "A-28",
      "A-29",
      "A-30",
    ]);
    const ids = new Map(
      preview.newLabels.map((label, index) => [
        label.toLowerCase(),
        { id: `new-${index}`, spaceId: seatUuid(index + 1) },
      ]),
    );
    const command = applySeatArrayCommand(
      document,
      seatAreaId,
      seatRows,
      settings,
      ids,
    )!;
    const store = editorStore(document);
    store.getState().execute(command);
    const next = store.getState().document;
    expect(next.seats).toHaveLength(30);
    document.seats.forEach((seat, index) =>
      expect(next.seats[index]).toMatchObject({
        id: seat.id,
        spaceId: seat.spaceId,
        label: seat.label,
      }),
    );
    expect(next.spaces).toBe(document.spaces);
    expect(next.seats[0]).toBe(document.seats[0]);
    expect(next.seats.at(-1)?.at).toEqual([16500, 17700]);
    expect(store.getState().undoStack).toHaveLength(1);
    store.getState().undo();
    expect(store.getState().document).toEqual(document);
    document.seats.forEach((seat, index) =>
      expect(store.getState().document.seats[index]).toBe(seat),
    );
    store.getState().redo();
    expect(store.getState().document).toEqual(next);
  });
  it("shrinks arrays without cloning remaining rows, and restores deletion indices", () => {
    const document = seatDocument();
    const keep = document.seats.filter((_, index) => index % 3 !== 0);
    const command = replaceSeatsCommand(document, keep, "shrink")!;
    const next = command.apply(document);
    expect(next.seats).toEqual(keep);
    keep.forEach((seat, index) => expect(next.seats[index]).toBe(seat));
    const restored = command.revert(next);
    expect(restored).toEqual(document);
    expect(command.apply(restored)).toEqual(next);
    const reordered = replaceSeatsCommand(
      document,
      [...document.seats].reverse(),
      "reorder",
    )!;
    expect(reordered.apply(document).seats).toEqual(
      [...document.seats].reverse(),
    );
    expect(reordered.revert(reordered.apply(document))).toEqual(document);
  });
  it("preserves irregular arrangements until a setting really changes", () => {
    const document = seatDocument();
    document.seats[4] = {
      ...document.seats[4]!,
      at: [13000, 10900],
      rotation: 90,
      label: "특별 좌석",
    };
    const initial = inferSeatArray(document, seatAreaId, seatRows)!;
    expect(initial.exact).toBe(false);
    const preview = previewSeatArray(
      document,
      seatAreaId,
      seatRows,
      initial.settings,
    );
    expect(preview).toMatchObject({
      changed: false,
      irregular: true,
      valid: true,
    });
    preview.seats.forEach((seat, index) =>
      expect(seat).toBe(document.seats[index]),
    );
    expect(
      applySeatArrayCommand(
        document,
        seatAreaId,
        seatRows,
        initial.settings,
        new Map(),
      ),
    ).toBeNull();
    expect(
      previewSeatArray(document, seatAreaId, seatRows, {
        ...initial.settings,
        prefix: "B-",
      }).changed,
    ).toBe(true);
  });
  it.each([0, 90, 180, 270] as const)(
    "uses rotated footprints for %s° spacing and infers them again",
    (rotation) => {
      const document = seatDocument();
      document.seats = [];
      const initial = inferSeatArray(document, seatAreaId, seatRows)!.settings;
      expect(initial.origin).toEqual([2000, 10000]);
      const settings = {
        ...initial,
        rows: 2,
        columns: 2,
        rotation,
        gapX: 0,
        gapY: 0,
      };
      const preview = previewSeatArray(
        document,
        seatAreaId,
        seatRows,
        settings,
      );
      const sideways = rotation === 90 || rotation === 270;
      expect(preview.seats.map(({ at }) => at)).toEqual(
        sideways
          ? [
              [2350, 10700],
              [3050, 10700],
              [2350, 12100],
              [3050, 12100],
            ]
          : [
              [2700, 10350],
              [4100, 10350],
              [2700, 11050],
              [4100, 11050],
            ],
      );
      const ids = new Map(
        preview.newLabels.map((label, index) => [
          label.toLowerCase(),
          { id: `seat-${index}`, spaceId: seatUuid(index + 1) },
        ]),
      );
      const next = applySeatArrayCommand(
        document,
        seatAreaId,
        seatRows,
        settings,
        ids,
      )!.apply(document);
      expect(inferSeatArray(next, seatAreaId, seatRows)).toMatchObject({
        exact: true,
        settings,
      });
    },
  );
  it("keeps odd-size centers integral and does not move a zero-delta unsnapped seat", () => {
    const document = seatDocument();
    document.seats[0] = { ...document.seats[0]!, size: [1401, 701] };
    expect(
      moveShapesCommand(document, [document.seats[0]!.id], [0, 0], {
        snap: false,
      }),
    ).toBeNull();
    const moved = moveShapesCommand(
      document,
      [document.seats[0]!.id],
      [1, -1],
      { snap: false },
    )!.apply(document);
    expect(moved.seats[0]!.at).toEqual([2501, 10499]);
  });
  it("blocks outside/ambiguous centers, invalid settings and missing ids without changing data", () => {
    const document = seatDocument();
    const initial = inferSeatArray(document, seatAreaId, seatRows)!.settings;
    expect(
      previewSeatArray(document, seatAreaId, seatRows, { ...initial, rows: 5 }),
    ).toMatchObject({ outsideCount: 6, valid: false });
    expect(
      previewSeatArray(document, seatAreaId, seatRows, { ...initial, rows: 0 })
        .valid,
    ).toBe(false);
    expect(
      previewSeatArray(document, seatAreaId, seatRows, {
        ...initial,
        origin: [300, 10000],
        columns: 1,
        rows: 1,
      }),
    ).toMatchObject({ outsideCount: 1, valid: false });
    expect(
      applySeatArrayCommand(
        document,
        seatAreaId,
        seatRows,
        { ...initial, rows: 5, gapY: 1100 },
        new Map(),
      ),
    ).toBeNull();
    const area = document.spaces.find(({ id }) => id === seatAreaId)!;
    const overlap = {
      ...document,
      spaces: [
        ...document.spaces,
        { ...area, id: "overlap", spaceId: seatUuid(999) },
      ],
    };
    expect(
      previewSeatArray(
        overlap,
        seatAreaId,
        [
          ...seatRows,
          { id: seatUuid(999), name: "겹친 구역", type: "desk_area" },
        ],
        initial,
      ),
    ).toMatchObject({ outsideCount: 24, valid: false });
    expect(inferSeatArray(document, "missing", seatRows)).toBeNull();
  });
  it("matches names case-insensitively without reusing ids from another area", () => {
    const document = seatDocument();
    const settings = {
      ...inferSeatArray(document, seatAreaId, seatRows)!.settings,
      prefix: "a-",
    };
    const preview = previewSeatArray(document, seatAreaId, seatRows, settings);
    expect(preview.newLabels).toEqual([]);
    expect(preview.seats.map(({ spaceId }) => spaceId)).toEqual(
      document.seats.map(({ spaceId }) => spaceId),
    );
    expect(
      applySeatArrayCommand(
        document,
        seatAreaId,
        seatRows,
        settings,
        new Map(),
      )!.apply(document).seats[0]!.label,
    ).toBe("a-01");
  });
  it("pads labels and enforces unicode prefix/count/start limits", () => {
    expect(seatLabels("A-", 98, 4)).toEqual(["A-98", "A-99", "A-100", "A-101"]);
    expect(seatLabels("", 1, 2)).toEqual(["01", "02"]);
    expect(seatLabels("가나다라마바", 999, 1)).toEqual(["가나다라마바999"]);
    for (const args of [
      ["가나다라마바사", 1, 1],
      ["A\0", 1, 1],
      ["A", 0, 1],
      ["A", 1000, 1],
      ["A", 1, 901],
    ] as const)
      expect(seatLabels(args[0], args[1], args[2])).toEqual([]);
  });
});

describe("individual seat commands and write locks", () => {
  it("renames, sizes, rotates, moves, aligns and deletes seats with reversible commands", () => {
    const document = seatDocument();
    const seat = document.seats[0]!;
    const renamed = setSeatCommand(document, seat.id, {
      label: "  변경 이름  ",
      size: [1000, 500],
    })!;
    expect(renamed.apply(document).seats[0]).toMatchObject({
      label: "변경 이름",
      size: [1000, 500],
    });
    expect(renamed.revert(renamed.apply(document))).toEqual(document);
    expect(
      rotateSeatsCommand(document, [seat.id])!.apply(document).seats[0]!
        .rotation,
    ).toBe(90);
    expect(
      rotateSeatsCommand(document, [seat.id], -90)!.apply(document).seats[0]!
        .rotation,
    ).toBe(270);
    expect(rotateSeatsCommand(document, [seat.id], 360)).toBeNull();
    expect(setSeatCommand(document, seat.id, { size: [399, 400] })).toBeNull();
    expect(
      setSeatCommand(document, seat.id, { label: "가".repeat(21) }),
    ).toBeNull();
    expect(setSeatCommand(document, seat.id, { rotation: 45 })).toBeNull();
    const cleared = setSeatCommand(document, seat.id, { label: " " })!.apply(
      document,
    );
    expect(cleared.seats[0]).not.toHaveProperty("label");
    expect(floorPlanSchema.safeParse(cleared).success).toBe(true);
    const deletion = deleteShapesCommand(document, [
      seat.id,
      document.seats[2]!.id,
    ])!;
    expect(deletion.apply(document).seats).toHaveLength(22);
    expect(deletion.revert(deletion.apply(document))).toEqual(document);
    expect(
      resizeShapeCommand(
        document,
        seat.id,
        { x: 1, y: 1, width: 1000, height: 1000 },
        { snap: false },
      ),
    ).toBeNull();
    const aligned = alignShapesCommand(
      document,
      [seat.id, document.seats[1]!.id],
      "left",
    )!.apply(document);
    expect(aligned.seats[0]!.at[0]).toBe(aligned.seats[1]!.at[0]);
  });
  it("duplicates mixed fixture and seat in one undo, with new ids and no blank label", () => {
    const document = seatDocument();
    let counter = 0;
    const command = duplicateEditableShapesCommand(
      document,
      [document.fixtures[0]!.id, document.seats[0]!.id],
      () => seatUuid(++counter),
    )!;
    const store = editorStore(document);
    store.getState().execute(command);
    const next = store.getState().document;
    expect(counter).toBe(3);
    expect(next.fixtures).toHaveLength(document.fixtures.length + 1);
    expect(next.seats.at(-1)).toMatchObject({
      id: seatUuid(2),
      spaceId: seatUuid(3),
      at: [2600, 10600],
    });
    expect(next.seats.at(-1)).not.toHaveProperty("label");
    expect(store.getState().undoStack).toHaveLength(1);
    store.getState().undo();
    expect(store.getState().document).toEqual(document);
    store.getState().redo();
    expect(store.getState().document).toEqual(next);
    expect(counter).toBe(3);
  });
  it.each(["writeLocked", "stale"] as const)(
    "rejects execute/undo/redo during %s and resets on explicit source replacement",
    (mode) => {
      const document = seatDocument();
      const store = editorStore(document);
      const command = setSeatCommand(document, document.seats[0]!.id, {
        label: "새 이름",
      })!;
      store.getState().execute(command);
      store.getState().undo();
      if (mode === "stale") store.setState({ saveState: "stale" });
      else store.getState().setWriteLocked(true);
      const snapshot = store.getState();
      expect(store.getState().execute(command)).toBe(false);
      expect(store.getState().undo()).toBe(false);
      expect(store.getState().redo()).toBe(false);
      expect(store.getState()).toBe(snapshot);
      store.getState().replaceSource({
        floorId: snapshot.floorId,
        basePlanId: null,
        document,
        draft: null,
        savedAt: null,
      });
      expect(store.getState().writeLocked).toBe(false);
      expect(store.getState().execute(command)).toBe(true);
    },
  );
});
