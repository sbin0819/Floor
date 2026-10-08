"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Check, Circle, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { HomeCard } from "@/features/bookings/components/home-frame";
import { dismissHomeChecklist } from "@/features/home/actions";
import type { HomeChecklist as HomeChecklistData } from "../types";

const steps = [
  { key: "emailVerified", label: "가입하고 이메일 인증" },
  {
    key: "username",
    label: "사용자 이름 정하기",
    action: "정하기",
    href: "/settings",
  },
  {
    key: "team",
    label: "팀 만들기 또는 들어가기",
    action: "팀 찾기",
    href: "/teams/start",
  },
  {
    key: "booking",
    label: "첫 공간 예약하기",
    action: "예약하기",
    href: "/booking",
  },
  {
    key: "friend",
    label: "친구 추가하기",
    action: "친구 찾기",
    href: "/friends",
  },
] as const;
const failure = "시작 안내를 닫지 못했어요. 잠시 뒤 다시 시도해 주세요";

export function HomeChecklist({
  data,
  dismissAction = dismissHomeChecklist,
}: {
  data: HomeChecklistData;
  dismissAction?: typeof dismissHomeChecklist;
}) {
  const router = useRouter();
  const [hidden, setHidden] = useState(false);
  const locked = useRef(false);
  const mounted = useRef(false);
  const deferredFailure = useRef(false);
  const mutation = useMutation({
    mutationFn: (input: Record<string, never>) => dismissAction(input),
    retry: false,
  });
  useEffect(() => {
    mounted.current = true;
    if (deferredFailure.current) {
      // Activity가 숨긴 동안 끝난 실패는 복귀할 때만 화면과 토스트에 반영한다.
      queueMicrotask(() => {
        if (!mounted.current || !deferredFailure.current) return;
        deferredFailure.current = false;
        setHidden(false);
        toast.error(failure);
      });
    }
    return () => {
      mounted.current = false;
    };
  }, []);
  const completed = steps.filter(({ key }) => data.steps[key]).length;
  const firstIncomplete = steps.find(({ key }) => !data.steps[key])?.key;
  function restoreFailure() {
    if (!mounted.current) {
      deferredFailure.current = true;
      return;
    }
    setHidden(false);
    toast.error(failure);
  }
  async function dismiss() {
    if (locked.current) return;
    locked.current = true;
    setHidden(true);
    try {
      const result = await mutation.mutateAsync({});
      if (!result.ok) {
        restoreFailure();
      } else if (mounted.current && window.location.pathname === "/") {
        router.refresh();
      }
    } catch {
      restoreFailure();
    } finally {
      locked.current = false;
    }
  }
  if (!data.visible || hidden) return null;
  return (
    <HomeCard
      title="Floor 시작하기"
      action={
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground tabular-nums">
            {completed} / 5
          </span>
          <Button
            variant="ghost"
            size="icon"
            aria-label="시작 안내 닫기"
            disabled={mutation.isPending}
            onClick={() => void dismiss()}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      }
    >
      <div
        role="progressbar"
        aria-label="Floor 시작하기 진행 상황"
        aria-valuenow={completed}
        aria-valuemin={0}
        aria-valuemax={5}
        aria-valuetext={`${completed} / 5 완료`}
        className="mb-4 h-2 overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full bg-primary"
          style={{ width: `${completed * 20}%` }}
        />
      </div>
      <ol className="divide-y divide-border">
        {steps.map((step) => {
          const done = data.steps[step.key];
          return (
            <li
              key={step.key}
              className="flex min-h-14 items-center gap-3 py-2"
            >
              {done ? (
                <Check
                  aria-hidden="true"
                  className="size-5 shrink-0 text-muted-foreground"
                />
              ) : (
                <Circle
                  aria-hidden="true"
                  className="size-5 shrink-0 text-muted-foreground"
                />
              )}
              <span
                className={cn(
                  "min-w-0 flex-1 text-sm",
                  done && "text-muted-foreground line-through",
                )}
              >
                {step.label}
                {done && <span className="sr-only">, 완료</span>}
              </span>
              {!done && "href" in step && (
                <Button
                  asChild
                  variant={step.key === firstIncomplete ? "default" : "outline"}
                  className="shrink-0"
                >
                  <Link href={step.href}>{step.action}</Link>
                </Button>
              )}
            </li>
          );
        })}
      </ol>
    </HomeCard>
  );
}
