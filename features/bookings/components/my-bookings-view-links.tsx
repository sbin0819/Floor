"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import {
  shouldInterceptNavigation,
  useOptimisticNavigation,
  type NavigateAction,
} from "@/components/optimistic-navigation";
import { SegmentedLink, SegmentedLinks } from "@/components/segmented-links";

export function MyBookingsViewLinks({ view }: { view: "list" | "calendar" }) {
  const router = useRouter();
  const navigate = useCallback<NavigateAction>(
    (href) => router.push(href),
    [router],
  );
  const selection = useOptimisticNavigation(view, navigate);
  return (
    <SegmentedLinks label="예약 보기 선택">
      {(["list", "calendar"] as const).map((value) => {
        const href =
          value === "calendar" ? "/bookings?view=calendar" : "/bookings";
        return (
          <SegmentedLink
            key={value}
            asChild
            selected={selection.value === value}
          >
            <Link
              href={href}
              onClick={(event) => {
                if (!shouldInterceptNavigation(event)) return;
                event.preventDefault();
                selection.change(value, href);
              }}
            >
              {value === "calendar" ? "달력" : "목록"}
            </Link>
          </SegmentedLink>
        );
      })}
    </SegmentedLinks>
  );
}
