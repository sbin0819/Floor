"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import type { FloorDayData } from "@/features/bookings/types";
import type { FloorView } from "@/features/bookings/floor-view";
import { floorHref } from "@/features/bookings/format";
import { filterFloorByPeople } from "@/features/bookings/people-filter";
import { FloorDay } from "./floor-day";
import { FloorTimetable } from "./floor-timetable";
import { useFloorView, useFloorPeople } from "./floor-view";
import { useFloorSelection } from "./branch-workspace";
import { ClosedFloorDay } from "./closed-floor-day";
import { FloorPeopleLink, FloorPeopleNotice } from "./floor-people-filter";
import { FloorPlanView } from "@/features/floor-plan/components/floor-plan-view";
import { useFloorRealtime } from "@/features/floor-plan/use-floor-realtime";

export function FloorViews({
  data,
  initialView,
}: {
  data: FloorDayData;
  initialView: FloorView | null;
}) {
  const { flashSpaceIds } = useFloorRealtime(data);
  const { effectiveView: view } = useFloorView(
    initialView,
    Boolean(data.floor.plan),
  );
  const { people } = useFloorPeople();
  const selection = useFloorSelection();
  const currentSearch = useSearchParams();
  const search = selection?.search ?? currentSearch;
  const registerFloor = selection?.registerFloor;
  useEffect(() => registerFloor?.(data), [registerFloor, data]);
  if (!data.openHours) return <ClosedFloorDay data={data} />;
  const filtered = filterFloorByPeople(
    data,
    people,
    selection?.location.spaceId ?? null,
  );
  const href = `${floorHref(data.branch.id, data.floor.id)}?${search}`;
  const content =
    people !== null && filtered.data.spaces.length === 0 ? (
      <div className="space-y-2 py-8 text-sm text-muted-foreground">
        <p>{people}명이 쓸 수 있는 공간이 이 층에 없어요</p>
        <FloorPeopleLink
          href={href}
          people={null}
          className="inline-flex min-h-11 items-center font-medium text-foreground underline underline-offset-4"
        >
          모두 보기
        </FloorPeopleLink>
      </div>
    ) : view === "plan" && data.floor.plan ? (
      <FloorPlanView
        key={`${data.floor.id}:${data.date}`}
        data={filtered.data}
        planId={data.floor.plan.id}
        flashSpaceIds={flashSpaceIds}
      />
    ) : view === "list" ? (
      <FloorDay data={filtered.data} />
    ) : (
      <FloorTimetable data={filtered.data} />
    );
  return (
    <div className="min-w-0 space-y-4">
      {people !== null && (
        <FloorPeopleNotice
          people={people}
          hiddenCount={filtered.hiddenCount}
          href={href}
        />
      )}
      {content}
    </div>
  );
}
