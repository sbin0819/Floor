"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { ComponentProps } from "react";
import { shouldInterceptNavigation } from "@/components/optimistic-navigation";
import type { FloorLocation } from "@/features/bookings/floor-selection";
import { carryFloorQuery } from "@/features/bookings/people-filter";
import { useFloorSelection } from "./branch-workspace";

export function FloorNavigationLink({
  location,
  href,
  replace,
  ...props
}: Omit<ComponentProps<typeof Link>, "onClick" | "href"> & {
  href: string;
  location: FloorLocation;
}) {
  const navigation = useFloorSelection();
  const currentSearch = useSearchParams();
  const search = navigation?.search ?? currentSearch;
  const destination = carryFloorQuery(href, search);
  return (
    <Link
      {...props}
      href={destination}
      replace={replace}
      onClick={(event) => {
        if (!navigation || !shouldInterceptNavigation(event)) return;
        event.preventDefault();
        if (!navigation.isCurrentRoute()) return;
        if (
          location.spaceId !== null &&
          (location.spaceId !== navigation.location.spaceId ||
            (location.detail && !navigation.location.detail))
        ) {
          navigation.rememberSpaceTrigger(
            event.currentTarget,
            location.spaceId,
          );
        }
        navigation.change(location, destination, { replace });
        if (
          (location.spaceId === null ||
            (navigation.location.detail && !location.detail)) &&
          location.floorId === navigation.location.floorId &&
          location.date === navigation.location.date
        )
          navigation.restoreSpaceTrigger();
      }}
    />
  );
}
