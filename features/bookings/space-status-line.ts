import {
  getAvailabilitySummary,
  type AvailabilitySummary,
} from "@/features/bookings/availability";
import { formatAvailabilityUntil } from "@/features/bookings/format";
import {
  getOperatingState,
  getOperatingWindow,
  type OperatingState,
} from "@/features/bookings/operating-state";
import type {
  FloorDayData,
  FloorVisibleSpace,
  SpaceDayData,
} from "@/features/bookings/types";
import { localDate, localTime } from "@/lib/time/zoned";

export type SpaceStatusLine = {
  kind: "free" | "busy" | "mine" | "maintenance" | "none";
  label: string;
};

type StatusSpace = Pick<
  FloorVisibleSpace,
  "bookable" | "deskCount" | "bookingCount"
>;
type StatusDay = {
  date: string;
  isToday: boolean;
  timeZone: string;
  operatingState: OperatingState;
};

function statusLine(
  day: StatusDay,
  space: StatusSpace,
  summary: AvailabilitySummary | null,
): SpaceStatusLine {
  if (!space.bookable)
    return {
      kind: "none",
      label:
        space.deskCount > 0
          ? `좌석 ${space.deskCount}석 · 좌석 예약은 준비 중이에요`
          : "예약 없이 이용해요",
    };
  const bookingLabel =
    space.bookingCount > 0 ? `예약 ${space.bookingCount}건` : "예약 없음";
  if (!day.isToday) return { kind: "none", label: bookingLabel };

  const operating = day.operatingState;
  if (operating.status === "closed") return { kind: "none", label: "쉬는 날" };
  if (operating.status === "after_close")
    return { kind: "none", label: "오늘 영업이 끝났어요" };
  if (operating.status === "before_open" && operating.window)
    return {
      kind: "none",
      label: `${localTime(new Date(operating.window.start), day.timeZone)}에 열어요`,
    };
  if (!summary || summary.status === "outside_hours")
    return { kind: "none", label: bookingLabel };
  if (summary.status === "busy")
    return {
      kind: "busy",
      label: summary.availableAt
        ? `${localTime(new Date(summary.availableAt), day.timeZone)}부터 비어 있음`
        : "오늘은 빈 시간이 없어요",
    };

  const until = formatAvailabilityUntil(summary.until, day.date, day.timeZone, {
    midnightAs24: summary.status !== "maintenance",
  });
  return {
    kind: summary.status,
    label:
      summary.status === "free"
        ? `${until} 비어 있음`
        : summary.status === "mine"
          ? `내 예약 · ${until}`
          : `점검 중 · ${until}`,
  };
}

export function getFloorSpaceStatusLine(
  data: Pick<FloorDayData, "date" | "isToday" | "operatingState"> & {
    branch: Pick<FloorDayData["branch"], "timezone">;
  },
  space: StatusSpace & Pick<FloorVisibleSpace, "summary">,
): SpaceStatusLine {
  return statusLine(
    { ...data, timeZone: data.branch.timezone },
    space,
    space.summary,
  );
}

export function getSpaceDayStatusLine(
  data: Pick<SpaceDayData, "date" | "now"> & {
    branch: Pick<SpaceDayData["branch"], "timezone" | "openHours">;
    space: StatusSpace;
    bookings: readonly Pick<
      SpaceDayData["bookings"][number],
      "start" | "end" | "isMine"
    >[];
    blocks: readonly Pick<SpaceDayData["blocks"][number], "start" | "end">[];
  },
): SpaceStatusLine {
  const now = new Date(data.now);
  const timeZone = data.branch.timezone;
  const isToday = data.date === localDate(now, timeZone);
  const operatingState = getOperatingState(
    now,
    timeZone,
    data.branch.openHours,
  );
  const summary =
    data.space.bookable && isToday && operatingState.status === "open"
      ? getAvailabilitySummary({
          now,
          window: getOperatingWindow(
            data.date,
            timeZone,
            data.branch.openHours,
          ),
          // 상세 DTO의 소유 여부만 사용해 별도 사용자 식별자를 요구하지 않는다.
          userId: "self",
          teamIds: [],
          bookings: data.bookings.map((booking) => ({
            start: new Date(booking.start),
            end: new Date(booking.end),
            userId: booking.isMine ? "self" : "other",
            teamId: null,
          })),
          blocks: data.blocks.map((block) => ({
            start: new Date(block.start),
            end: new Date(block.end),
          })),
        })
      : null;
  return statusLine(
    { date: data.date, isToday, timeZone, operatingState },
    data.space,
    summary,
  );
}
