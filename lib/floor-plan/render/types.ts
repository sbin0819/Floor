export type Point = readonly [number, number];
export type Camera = { scale: number; x: number; y: number };
export type Viewport = { width: number; height: number };
export type Box = { minX: number; minY: number; maxX: number; maxY: number };
type ShapeBase = {
  id: string;
  spaceId: string | null;
  points: readonly Point[];
  bounds: Box;
  labelAt: Point;
  order: number;
};
export type PolygonShape = ShapeBase & {
  kind: "space" | "seat" | "fixture";
  label?: string;
};
export type WallShape = ShapeBase & {
  kind: "wall";
  thickness: number;
  segments: readonly (readonly [Point, Point])[];
};
export type OpeningShape = ShapeBase & {
  kind: "opening";
  hinge: Point;
  angle: number;
  radius: number;
  door: boolean;
};
export type PlanShape = PolygonShape | WallShape | OpeningShape;
export type PlanScene = {
  bounds: { w: number; h: number };
  shapes: readonly PlanShape[];
};
export type PlanSpatialIndex = { search: (box: Box) => PlanShape[] };
export type PlanStateKind =
  "free" | "booked" | "mine" | "maintenance" | "restricted" | "neutral";
export type PlanShapeState = {
  kind: PlanStateKind;
  name: string;
  label?: string;
  deskArea?: boolean;
  hidden?: boolean;
};
export type PlanStates = ReadonlyMap<string, PlanShapeState>;
export type PlanPalette = { fill: string; stroke: string; text: string };
export type PlanColors = Record<PlanStateKind | "fixture", PlanPalette> & {
  background: string;
  border: string;
  foreground: string;
  muted: string;
  selection: string;
  focus: string;
  shadow: string;
  maintenancePattern?: CanvasPattern;
};
export type PlanFrame = {
  scene: PlanScene;
  index: PlanSpatialIndex;
  camera: Camera;
  viewport: Viewport;
  dpr: number;
  colors: PlanColors;
  states: PlanStates;
};
export type PlanOverlay = {
  hoveredId?: string | null;
  selectedId?: string | null;
  focusedId?: string | null;
};
export type PlanContext = Pick<
  CanvasRenderingContext2D,
  | "save"
  | "restore"
  | "setTransform"
  | "clearRect"
  | "fillRect"
  | "beginPath"
  | "moveTo"
  | "lineTo"
  | "closePath"
  | "rect"
  | "arc"
  | "fill"
  | "stroke"
  | "clip"
  | "setLineDash"
  | "fillText"
  | "measureText"
  | "fillStyle"
  | "strokeStyle"
  | "lineWidth"
  | "lineCap"
  | "lineJoin"
  | "font"
  | "textAlign"
  | "textBaseline"
  | "shadowColor"
  | "shadowBlur"
>;
export type PlanDrawOptions = { createPath?: () => Path2D | null };
