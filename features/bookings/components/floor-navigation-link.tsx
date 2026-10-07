"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { ComponentProps } from "react";
import { shouldInterceptNavigation } from "@/components/optimistic-navigation";
import type { FloorLocation } from "@/features/bookings/floor-selection";
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
  const search = useSearchParams();
  const view = search.get("view");
  const target = new URL(href, "http://floor.local");
  if (view && !target.searchParams.has("view"))
    target.searchParams.set("view", view);
  const destination = `${target.pathname}${target.search}${target.hash}`;
  return (
    <Link
      {...props}
      href={destination}
      replace={replace}
      onClick={(event) => {
        if (!navigation || !shouldInterceptNavigation(event)) return;
        event.preventDefault();
        if (
          location.spaceId !== null &&
          location.spaceId !== navigation.location.spaceId
        ) {
          navigation.rememberSpaceTrigger(
            event.currentTarget,
            location.spaceId,
          );
        }
        navigation.change(location, destination, { replace });
      }}
    />
  );
}
