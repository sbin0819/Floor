"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
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
  override: FloorView | null;
  setOverride: (value: FloorView | null) => void;
} | null>(null);
export function FloorViewProvider({
  cookieView,
  children,
}: {
  cookieView: FloorView | null;
  children: ReactNode;
}) {
  const [preference, setPreference] = useState(cookieView);
  const [override, setOverride] = useState<FloorView | null>(null);
  return (
    <ViewPreference.Provider
      value={{ value: preference, set: setPreference, override, setOverride }}
    >
      {children}
    </ViewPreference.Provider>
  );
}
export function useFloorView(initialView?: FloorView | null) {
  const search = useSearchParams();
  const preference = useContext(ViewPreference);
  const wide = useWideScreen();
  const view =
    preference?.override ??
    resolveFloorView(
      searchValue(search, "view"),
      preference?.value ?? initialView,
    );
  return {
    view,
    effectiveView: view ?? (wide ? "timeline" : "list"),
    setPreference: preference?.set,
    override: preference?.override ?? null,
    setOverride: preference?.setOverride,
  };
}
function pushViewHistory(view: FloorView) {
  const current = new URL(window.location.href);
  current.searchParams.set("view", view);
  window.history.pushState(
    null,
    "",
    `${current.pathname}${current.search}${current.hash}`,
  );
}
export function FloorViewControl({ className }: { className?: string }) {
  const params = useParams<{ branchId: string; floorId?: string }>();
  const search = useSearchParams();
  const selection = useFloorSelection();
  const { effectiveView, setPreference, override, setOverride } =
    useFloorView();
  const queuedView = useRef<FloorView | null>(null);
  const pending = selection?.navigationPending ?? false;
  const currentView = searchValue(search, "view");
  useEffect(() => {
    if (pending || queuedView.current === null) return;
    // Next의 native history 복원은 진행 중인 라우터 이동을 버릴 수 있다.
    // 완료된 주소에서 보기만 바꾸고, 서버가 읽은 날짜·공간 키는 보존한다.
    const view = queuedView.current;
    queuedView.current = null;
    pushViewHistory(view);
  }, [pending, override]);
  useEffect(() => {
    if (
      !pending &&
      queuedView.current === null &&
      override !== null &&
      currentView === override
    )
      setOverride?.(null);
  }, [pending, override, currentView, setOverride]);
  const floorId = params.floorId;
  if (!floorId) return null;
  return (
    <SegmentedLinks label="보기 선택" className={className}>
      {(["list", "timeline"] as const).map((view) => {
        const Icon = view === "list" ? List : Table2;
        const label = view === "list" ? "목록" : "시간표";
        const query = new URLSearchParams(search.toString());
        query.set("view", view);
        const href = `${floorHref(params.branchId, floorId)}?${query}`;
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
                setOverride?.(view);
                if (pending) queuedView.current = view;
                else {
                  queuedView.current = null;
                  pushViewHistory(view);
                }
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
  const closed = useFloorSelection()?.floorData?.openHours === null;
  return (
    <div
      className={cn(
        "grid min-w-0 items-start gap-6",
        view === "list" && !closed && "lg:grid-cols-[minmax(0,1fr)_420px]",
      )}
    >
      {children}
    </div>
  );
}
