"use client";

import Link from "next/link";
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
  return (
    <Link
      {...props}
      href={href}
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
        navigation.change(location, href, { replace });
      }}
    />
  );
}
