"use client";

import type { FloorDayData } from "@/features/bookings/types";
import type { FloorView } from "@/features/bookings/floor-view";
import { FloorDay } from "./floor-day";
import { FloorTimetable } from "./floor-timetable";
import { useFloorView } from "./floor-view";

export function FloorViews({
  data,
  initialView,
}: {
  data: FloorDayData;
  initialView: FloorView | null;
}) {
  const { view } = useFloorView(initialView);
  if (view === "list") return <FloorDay data={data} />;
  if (view === "timeline") return <FloorTimetable data={data} />;
  return (
    <>
      <div data-floor-view="list" className="lg:hidden">
        <FloorDay data={data} />
      </div>
      <div data-floor-view="timeline" className="hidden lg:block">
        <FloorTimetable data={data} />
      </div>
    </>
  );
}
