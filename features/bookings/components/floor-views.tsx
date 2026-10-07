"use client";

import { useEffect } from "react";
import type { FloorDayData } from "@/features/bookings/types";
import type { FloorView } from "@/features/bookings/floor-view";
import { FloorDay } from "./floor-day";
import { FloorTimetable } from "./floor-timetable";
import { useFloorView } from "./floor-view";
import { useFloorSelection } from "./branch-workspace";
import { ClosedFloorDay } from "./closed-floor-day";

export function FloorViews({
  data,
  initialView,
}: {
  data: FloorDayData;
  initialView: FloorView | null;
}) {
  const { view } = useFloorView(initialView);
  const registerFloor = useFloorSelection()?.registerFloor;
  useEffect(() => registerFloor?.(data), [registerFloor, data]);
  if (!data.openHours) return <ClosedFloorDay data={data} />;
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
