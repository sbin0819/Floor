"use client";

import { useEffect, useRef } from "react";
import { useStatusPresencePublisher } from "@/components/realtime-provider";
import { createStatusActivity } from "../status-activity";
import type { UserStatus } from "../status";

export function StatusSync({ status }: { status: UserStatus }) {
  const publish = useStatusPresencePublisher();
  const initial = useRef(status);
  const activity = useRef<ReturnType<typeof createStatusActivity> | null>(null);
  useEffect(() => {
    const controller = createStatusActivity({
      selected: initial.current,
      publish,
    });
    activity.current = controller;
    return () => {
      activity.current = null;
      controller.close();
    };
  }, [publish]);
  useEffect(() => {
    activity.current?.setSelected(status);
  }, [status]);
  return null;
}
