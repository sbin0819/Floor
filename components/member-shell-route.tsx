"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { memberSectionName } from "@/components/member-navigation";

export function MemberSectionName() {
  const pathname = usePathname();
  return (
    <span className="min-w-0 truncate text-base font-semibold">
      {memberSectionName(pathname)}
    </span>
  );
}

export function CloseOnRouteChange({ onChange }: { onChange: () => void }) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const route = `${pathname}?${search}`;
  const previous = useRef(route);
  useEffect(() => {
    if (previous.current === route) return;
    previous.current = route;
    onChange();
  }, [route, onChange]);
  return null;
}
