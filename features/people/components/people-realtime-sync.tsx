"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { useRealtimeChannel } from "@/components/realtime-provider";
import { userChannel } from "@/lib/realtime/channels";

export function PeopleRealtimeSync({ userId }: { userId: string }) {
  const client = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const timers = useRef<{
    friends: ReturnType<typeof setTimeout> | null;
    notifications: ReturnType<typeof setTimeout> | null;
  }>({ friends: null, notifications: null });
  const path = useRef(pathname);
  useEffect(() => {
    path.current = pathname;
  }, [pathname]);
  useEffect(() => {
    const current = timers.current;
    return () => {
      if (current.friends) clearTimeout(current.friends);
      if (current.notifications) clearTimeout(current.notifications);
      current.friends = null;
      current.notifications = null;
    };
  }, [userId]);
  useRealtimeChannel(userChannel(userId), (event) => {
    const current = timers.current;
    if (event.type === "friend.changed" && current.friends === null) {
      current.friends = setTimeout(() => {
        current.friends = null;
        void client.invalidateQueries({ queryKey: ["people"] });
        if (path.current === "/friends") router.refresh();
      }, 150);
    }
    if (
      event.type === "notifications.changed" &&
      current.notifications === null
    ) {
      current.notifications = setTimeout(() => {
        current.notifications = null;
        void client.invalidateQueries({ queryKey: ["notifications"] });
      }, 150);
    }
  });
  return null;
}
