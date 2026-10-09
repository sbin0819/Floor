"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWideScreen } from "@/features/bookings/components/use-wide-screen";

const key = "floor-plan-touch-hint-dismissed";
export function PlanTouchHint() {
  const wide = useWideScreen();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (wide) return;
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(key) === "1";
    } catch {
      /* 저장소가 막혀도 조작은 가능하다. */
    }
    const frame = requestAnimationFrame(() => setVisible(!dismissed));
    return () => cancelAnimationFrame(frame);
  }, [wide]);
  if (wide || !visible) return null;
  return (
    <div className="flex items-center justify-between gap-2 border-b border-border bg-secondary px-3 text-sm">
      <p>두 손가락으로 확대·이동</p>
      <Button
        variant="ghost"
        size="icon"
        aria-label="평면도 조작 안내 닫기"
        onClick={() => {
          setVisible(false);
          try {
            localStorage.setItem(key, "1");
          } catch {
            /* 안내 닫기는 현재 화면에서도 유지한다. */
          }
        }}
      >
        <X aria-hidden="true" />
      </Button>
    </div>
  );
}
