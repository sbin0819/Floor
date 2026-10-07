"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { List, Table2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { shouldInterceptNavigation } from "@/components/optimistic-navigation";
import { SegmentedLink, SegmentedLinks } from "@/components/segmented-links";
import {
  resolveFloorView,
  type FloorView,
} from "@/features/bookings/floor-view";
import { floorHref } from "@/features/bookings/format";
import { searchValue } from "@/features/bookings/floor-selection";
import { useFloorSelection } from "./branch-workspace";
import { useWideScreen } from "./use-wide-screen";

const ViewPreference = createContext<{
  value: FloorView | null;
  set: (value: FloorView) => void;
} | null>(null);
export function FloorViewProvider({
  cookieView,
  children,
}: {
  cookieView: FloorView | null;
  children: ReactNode;
}) {
  const [preference, setPreference] = useState(cookieView);
  return (
    <ViewPreference.Provider value={{ value: preference, set: setPreference }}>
      {children}
    </ViewPreference.Provider>
  );
}
export function useFloorView(initialView?: FloorView | null) {
  const search = useSearchParams();
  const preference = useContext(ViewPreference);
  const wide = useWideScreen();
  const view = resolveFloorView(
    searchValue(search, "view"),
    preference?.value ?? initialView,
  );
  return {
    view,
    effectiveView: view ?? (wide ? "timeline" : "list"),
    setPreference: preference?.set,
  };
}
export function FloorViewControl({ className }: { className?: string }) {
  const params = useParams<{ branchId: string; floorId?: string }>();
  const search = useSearchParams();
  const selection = useFloorSelection();
  const { effectiveView, setPreference } = useFloorView();
  const floorId = selection?.location.floorId || params.floorId;
  if (!floorId) return null;
  return (
    <SegmentedLinks label="보기 선택" className={className}>
      {(["list", "timeline"] as const).map((view) => {
        const Icon = view === "list" ? List : Table2;
        const label = view === "list" ? "목록" : "시간표";
        const href = floorHref(
          params.branchId,
          floorId,
          selection?.location.date || search.get("date") || undefined,
          selection
            ? (selection.location.spaceId ?? undefined)
            : (search.get("space") ?? undefined),
          view,
        );
        return (
          <SegmentedLink key={view} selected={view === effectiveView} asChild>
            <a
              href={href}
              aria-label={`${label} 보기`}
              aria-current={view === effectiveView ? "page" : undefined}
              onClick={(event) => {
                if (!shouldInterceptNavigation(event)) return;
                event.preventDefault();
                document.cookie = `floor_view=${view}; Path=/; Max-Age=31536000; SameSite=Lax`;
                setPreference?.(view);
                window.history.pushState(null, "", href);
              }}
            >
              <Icon className="size-4" aria-hidden="true" />
              <span className="hidden lg:inline">{label}</span>
            </a>
          </SegmentedLink>
        );
      })}
    </SegmentedLinks>
  );
}
export function FloorScreenLayout({ children }: { children: ReactNode }) {
  const { view } = useFloorView();
  return (
    <div
      className={cn(
        "grid min-w-0 items-start gap-6",
        view === "list" && "lg:grid-cols-[minmax(0,1fr)_420px]",
      )}
    >
      {children}
    </div>
  );
}
