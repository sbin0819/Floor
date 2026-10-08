"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useRealtimeChannel } from "@/components/realtime-provider";
import { userChannel } from "@/lib/realtime/channels";

export function HomeRefresh({ userId }: { userId: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const active = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refresh = useCallback(() => {
    if (
      active.current &&
      pathname === "/" &&
      document.visibilityState === "visible"
    )
      router.refresh();
  }, [pathname, router]);
  useRealtimeChannel(pathname === "/" ? userChannel(userId) : null, (event) => {
    if (!active.current || pathname !== "/") return;
    if (
      event.type !== "friend.changed" &&
      event.type !== "notifications.changed" &&
      event.type !== "mention.created" &&
      !(
        event.type === "room.activity" &&
        (event.roomKind === "dm" || event.roomKind === "group_dm")
      )
    )
      return;
    // 비활성 탭의 변화는 보일 때 한 번 읽으므로 타이머와 요청을 만들지 않는다.
    if (document.visibilityState !== "visible" || timer.current !== null)
      return;
    timer.current = setTimeout(() => {
      timer.current = null;
      refresh();
    }, 2000);
  });
  useEffect(() => {
    if (pathname !== "/") return;
    active.current = true;
    const clear = () => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
    };
    const onVisibility = () => {
      clear();
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active.current = false;
      clear();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [pathname, refresh]);
  return null;
}
