import { describe, expect, it, vi } from "vitest";
import {
  createVertexIndex,
  snapPoint,
  type SnapContext,
  type VertexIndex,
} from "@/features/floor-plan/editor/snapping";
import { editorDocument } from "../helpers/plan-editor-store";

const none: VertexIndex = { search: () => [] };
const context = (patch: Partial<SnapContext> = {}): SnapContext => ({
  scale: 1,
  grid: true,
  vertices: none,
  ...patch,
});
describe("editor point snapping", () => {
  it("prioritizes vertex over angle over grid and emits a matching guide", () => {
    const vertices = createVertexIndex(editorDocument());
    expect(
      snapPoint(
        [1005, 1000],
        context({ vertices, shift: true, origin: [500, 200] }),
      ),
    ).toEqual({
      point: [1000, 1000],
      kind: "vertex",
      guide: { from: [1005, 1000], to: [1000, 1000] },
    });
    expect(
      snapPoint([250, 110], context({ shift: true, origin: [0, 0] })),
    ).toMatchObject({ point: [180, 180], kind: "angle" });
    expect(snapPoint([250, 110], context())).toEqual({
      point: [300, 100],
      kind: "grid",
    });
  });
  it("measures vertex distance in CSS pixels for zoom and excludes self", () => {
    const vertices = createVertexIndex(editorDocument());
    expect(
      snapPoint([1079, 1000], context({ scale: 0.1, vertices })).kind,
    ).toBe("vertex");
    expect(
      snapPoint([1081, 1000], context({ scale: 0.1, vertices })).kind,
    ).toBe("grid");
    expect(snapPoint([1008, 1000], context({ vertices })).kind).toBe("vertex");
    expect(snapPoint([1009, 1000], context({ vertices })).kind).toBe("grid");
    expect(
      snapPoint([1005, 1000], context({ vertices, excludeShapeIds: ["a"] }))
        .kind,
    ).toBe("grid");
  });
  it("uses stable source order for equidistant vertices instead of RBush order", () => {
    const vertices: VertexIndex = {
      search: () => [
        { shapeId: "b", index: 0, at: [104, 100], order: 2 },
        { shapeId: "a", index: 0, at: [100, 104], order: 1 },
      ],
    };
    expect(snapPoint([100, 100], context({ vertices })).point).toEqual([
      100, 104,
    ]);
  });
  it.each([
    [100, 5, 100, 0],
    [5, 100, 0, 100],
    [-100, 5, -100, 0],
    [5, -100, 0, -100],
    [100, 80, 90, 90],
    [-100, 80, -90, 90],
    [-100, -80, -90, -90],
    [100, -80, 90, -90],
  ])("projects to a 45° multiple for (%s,%s)", (x, y, outX, outY) => {
    expect(
      snapPoint([x, y], context({ shift: true, origin: [0, 0] })).point,
    ).toEqual([outX, outY]);
  });
  it("Alt bypasses every snap while retaining integral coordinates", () => {
    const search = vi.fn(() => []);
    expect(
      snapPoint(
        [1004.4, 1003.8],
        context({
          vertices: { search },
          alt: true,
          shift: true,
          origin: [0, 0],
        }),
      ),
    ).toEqual({ point: [1004, 1004], kind: null });
    expect(search).not.toHaveBeenCalled();
    expect(snapPoint([144.4, 115.6], context({ grid: false }))).toEqual({
      point: [144, 116],
      kind: null,
    });
  });
  it("indexes walls, fixtures, spaces and seat corners once and uses a narrow search", () => {
    const document = editorDocument();
    document.seats = [
      {
        id: "seat",
        spaceId: "10000000-0000-4000-8000-000000000001",
        at: [500, 500],
        size: [400, 600],
        rotation: 90,
      },
    ];
    const vertices = createVertexIndex(document);
    expect(
      vertices
        .search({ minX: 199, maxX: 201, minY: 299, maxY: 301 })
        .map(({ shapeId }) => shapeId),
    ).toEqual(["seat"]);
    const search = vi.spyOn(vertices, "search");
    snapPoint([8000, 8000], context({ vertices, scale: 0.5 }));
    expect(search).toHaveBeenCalledOnce();
    expect(search).toHaveBeenCalledWith({
      minX: 7984,
      maxX: 8016,
      minY: 7984,
      maxY: 8016,
    });
  });
});
