import {
  isSimplePolygon,
  pointInPolygonStrict,
} from "@/lib/floor-plan/geometry";
import { seatDisplayName } from "@/lib/floor-plan/seats";
import { boundsOf } from "@/lib/floor-plan/render/scene";
import type { FloorPlanDocument, PlanPoint } from "@/lib/floor-plan/types";
import {
  replaceSeatsCommand,
  type Command,
  type SeatShape,
  type SpaceShape,
} from "./commands";

export type SeatArraySpace = {
  id: string;
  name: string;
  type: string;
  archived?: boolean;
};
export type SeatArraySettings = {
  rows: number;
  columns: number;
  width: number;
  depth: number;
  gapX: number;
  gapY: number;
  rotation: 0 | 90 | 180 | 270;
  prefix: string;
  start: number;
  origin: PlanPoint;
};
export type SeatArrayPreview = {
  seats: readonly SeatShape[];
  currentCount: number;
  outsideCount: number;
  newLabels: readonly string[];
  valid: boolean;
  changed: boolean;
  irregular: boolean;
  error: string | null;
};
const normalName = (value: string) => value.trim().toLowerCase();
const inRange = (value: number, min: number, max: number) =>
  Number.isInteger(value) && value >= min && value <= max;
function footprint(width: number, depth: number, rotation: number): PlanPoint {
  return rotation % 180 === 0 ? [width, depth] : [depth, width];
}
function labelOf(seat: SeatShape, names: ReadonlyMap<string, string>) {
  const name = names.get(seat.spaceId.toLowerCase());
  return seatDisplayName(seat, name === undefined ? null : { name }) ?? "";
}
function areaAndNames(
  document: FloorPlanDocument,
  areaId: string,
  spaces: readonly SeatArraySpace[],
) {
  const rows = new Map(spaces.map((space) => [space.id.toLowerCase(), space]));
  const areas = document.spaces.filter((shape) => {
    const row = rows.get(shape.spaceId.toLowerCase());
    return (
      row?.type === "desk_area" &&
      !row.archived &&
      isSimplePolygon(shape.polygon)
    );
  });
  const area = areas.find(({ id }) => id === areaId);
  if (!area) return null;
  const names = new Map(spaces.map(({ id, name }) => [id.toLowerCase(), name]));
  const seats = document.seats.filter((seat) =>
    pointInPolygonStrict(seat.at, area.polygon),
  );
  return { area, areas, names, seats };
}
export function seatLabels(
  prefix: string,
  start: number,
  count: number,
): string[] {
  if (
    Array.from(prefix).length > 6 ||
    prefix.includes("\0") ||
    !inRange(start, 1, 999) ||
    !inRange(count, 0, 900)
  )
    return [];
  return Array.from({ length: count }, (_, index) =>
    `${prefix}${String(start + index).padStart(2, "0")}`.trim(),
  );
}
function defaultSettings(area: SpaceShape): SeatArraySettings {
  const box = boundsOf(area.polygon);
  return {
    rows: 1,
    columns: 1,
    width: 1400,
    depth: 700,
    gapX: 1400,
    gapY: 1300,
    rotation: 0,
    prefix: "A-",
    start: 1,
    origin: [box.minX + 1000, box.minY + 1000],
  };
}
function validSettings(settings: SeatArraySettings) {
  return (
    inRange(settings.rows, 1, 30) &&
    inRange(settings.columns, 1, 30) &&
    inRange(settings.width, 400, 3000) &&
    inRange(settings.depth, 400, 3000) &&
    inRange(settings.gapX, 0, 5000) &&
    inRange(settings.gapY, 0, 5000) &&
    [0, 90, 180, 270].includes(settings.rotation) &&
    settings.origin.every(Number.isFinite) &&
    seatLabels(
      settings.prefix,
      settings.start,
      settings.rows * settings.columns,
    ).length ===
      settings.rows * settings.columns
  );
}
function positions(settings: SeatArraySettings) {
  const [w, h] = footprint(settings.width, settings.depth, settings.rotation);
  return seatLabels(
    settings.prefix,
    settings.start,
    settings.rows * settings.columns,
  ).map((label, index) => ({
    at: [
      Math.round(
        settings.origin[0] +
          w / 2 +
          (index % settings.columns) * (w + settings.gapX),
      ),
      Math.round(
        settings.origin[1] +
          h / 2 +
          Math.floor(index / settings.columns) * (h + settings.gapY),
      ),
    ] as PlanPoint,
    size: [settings.width, settings.depth] as [number, number],
    rotation: settings.rotation,
    label,
  }));
}
function sameGeometry(
  a: SeatShape,
  b: Pick<SeatShape, "at" | "size" | "rotation">,
) {
  return (
    a.at[0] === b.at[0] &&
    a.at[1] === b.at[1] &&
    a.size[0] === b.size[0] &&
    a.size[1] === b.size[1] &&
    a.rotation === b.rotation
  );
}
export function inferSeatArray(
  document: FloorPlanDocument,
  areaId: string,
  spaces: readonly SeatArraySpace[],
) {
  const source = areaAndNames(document, areaId, spaces);
  if (!source) return null;
  const defaults = defaultSettings(source.area);
  if (!source.seats.length)
    return { settings: defaults, exact: true, currentSeats: source.seats };
  const ordered = [...source.seats].sort(
    (a, b) =>
      a.at[1] - b.at[1] || a.at[0] - b.at[0] || a.id.localeCompare(b.id),
  );
  const first = ordered[0]!;
  const xs = [...new Set(ordered.map(({ at }) => at[0]))].sort((a, b) => a - b);
  const ys = [...new Set(ordered.map(({ at }) => at[1]))].sort((a, b) => a - b);
  const [w, h] = footprint(first.size[0], first.size[1], first.rotation);
  const parsed = /^(.*?)(\d+)$/u.exec(labelOf(first, source.names));
  const candidate: SeatArraySettings = {
    rows: ys.length,
    columns: xs.length,
    width: first.size[0],
    depth: first.size[1],
    gapX: xs.length > 1 ? xs[1]! - xs[0]! - w : defaults.gapX,
    gapY: ys.length > 1 ? ys[1]! - ys[0]! - h : defaults.gapY,
    rotation: [0, 90, 180, 270].includes(first.rotation)
      ? (first.rotation as SeatArraySettings["rotation"])
      : 0,
    prefix: parsed?.[1] ?? defaults.prefix,
    start: parsed ? Number(parsed[2]) : defaults.start,
    origin: [first.at[0] - w / 2, first.at[1] - h / 2],
  };
  const settings = validSettings(candidate) ? candidate : defaults;
  const expected = positions(settings);
  const exact =
    expected.length === ordered.length &&
    expected.every(
      (seat, index) =>
        sameGeometry(ordered[index]!, seat) &&
        labelOf(ordered[index]!, source.names) === seat.label,
    );
  return { settings, exact, currentSeats: source.seats };
}
export function previewSeatArray(
  document: FloorPlanDocument,
  areaId: string,
  spaces: readonly SeatArraySpace[],
  settings: SeatArraySettings,
): SeatArrayPreview {
  const source = areaAndNames(document, areaId, spaces);
  const initial = inferSeatArray(document, areaId, spaces);
  const empty = {
    seats: [],
    currentCount: source?.seats.length ?? 0,
    outsideCount: 0,
    newLabels: [],
    changed: false,
    irregular: false,
  };
  if (!source || !initial)
    return { ...empty, valid: false, error: "데스크 구역을 먼저 골라 주세요" };
  if (!validSettings(settings))
    return {
      ...empty,
      valid: false,
      error: "줄·칸, 좌석 크기, 간격과 이름을 확인해 주세요",
    };
  const byName = new Map<string, SeatShape>();
  let ambiguous = false;
  for (const seat of source.seats) {
    const name = normalName(labelOf(seat, source.names));
    if (name && byName.has(name)) ambiguous = true;
    if (name) byName.set(name, seat);
  }
  const unchangedIrregular =
    !initial.exact &&
    JSON.stringify(settings) === JSON.stringify(initial.settings);
  const newLabels: string[] = [];
  const seats = unchangedIrregular
    ? source.seats
    : positions(settings).map((value, index): SeatShape => {
        const existing = byName.get(normalName(value.label));
        if (
          existing &&
          sameGeometry(existing, value) &&
          labelOf(existing, source.names) === value.label
        )
          return existing;
        if (!existing) newLabels.push(value.label);
        return {
          ...value,
          id: existing?.id ?? `preview-seat-${areaId}-${index}`,
          spaceId: existing?.spaceId ?? `preview-seat-${areaId}-${index}`,
        };
      });
  const outsideCount = seats.filter((seat) => {
    const areas = source.areas.filter((area) =>
      pointInPolygonStrict(seat.at, area.polygon),
    );
    return (
      areas.length !== 1 ||
      areas[0]!.id !== areaId ||
      seat.at[0] < 0 ||
      seat.at[1] < 0 ||
      seat.at[0] > document.bounds.w ||
      seat.at[1] > document.bounds.h
    );
  }).length;
  const current = new Map(source.seats.map((seat) => [seat.id, seat]));
  const changed =
    seats.length !== source.seats.length ||
    seats.some((seat) => current.get(seat.id) !== seat);
  const total = document.seats.length - source.seats.length + seats.length;
  const error =
    ambiguous && !unchangedIrregular
      ? "같은 이름의 좌석을 먼저 구분해 주세요"
      : total > 2000
        ? "평면도에는 좌석을 2,000개까지 둘 수 있어요"
        : outsideCount
          ? `구역 밖으로 나가는 좌석이 ${outsideCount}개 있어요`
          : null;
  return {
    seats,
    currentCount: source.seats.length,
    outsideCount,
    newLabels,
    valid: error === null,
    changed,
    irregular: !initial.exact,
    error,
  };
}
export function applySeatArrayCommand(
  document: FloorPlanDocument,
  areaId: string,
  spaces: readonly SeatArraySpace[],
  settings: SeatArraySettings,
  idsByNewLabel: ReadonlyMap<string, { id: string; spaceId: string }>,
): Command | null {
  const preview = previewSeatArray(document, areaId, spaces, settings);
  const source = areaAndNames(document, areaId, spaces);
  if (!source || !preview.valid || !preview.changed) return null;
  const existingIds = new Set(source.seats.map(({ id }) => id));
  const desired: SeatShape[] = [];
  for (const seat of preview.seats) {
    if (existingIds.has(seat.id)) desired.push(seat);
    else {
      const ids = idsByNewLabel.get(normalName(seat.label ?? ""));
      if (!ids) return null;
      desired.push({ ...seat, ...ids });
    }
  }
  const byId = new Map(desired.map((seat) => [seat.id, seat]));
  // 이름을 잇는 좌석의 원래 순서와 다른 구역의 좌석은 그대로 두어요.
  const next = document.seats.flatMap((seat) =>
    existingIds.has(seat.id)
      ? byId.has(seat.id)
        ? [byId.get(seat.id)!]
        : []
      : [seat],
  );
  next.push(...desired.filter((seat) => !existingIds.has(seat.id)));
  return replaceSeatsCommand(document, next, "좌석 배열 적용");
}
