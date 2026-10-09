"use client";

import { useId, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { setDefaultBranch } from "@/features/bookings/actions";
import { applyChatPreferences } from "@/features/chat/nav-state";
import { NOTIFICATION_SUMMARY_KEY } from "@/features/notifications/components/use-notifications";
import { updatePreferences } from "@/features/settings/actions";
import type { Preferences } from "../schema";
import type { PreferenceSettings as PreferenceSettingsData } from "../types";
import { SettingsCard } from "./settings-shell";

export function PreferenceSettings({
  data,
  save = updatePreferences,
  saveBranch = setDefaultBranch,
}: {
  data: PreferenceSettingsData;
  save?: typeof updatePreferences;
  saveBranch?: typeof setDefaultBranch;
}) {
  const id = useId();
  const router = useRouter();
  const client = useQueryClient();
  const [preferences, setPreferences] = useState<Preferences>(data);
  const [branchId, setBranchId] = useState(data.defaultBranchId);
  const [error, setError] = useState("");
  const [branchError, setBranchError] = useState("");
  const lock = useRef(false);
  const branchLock = useRef(false);
  const mutation = useMutation({
    mutationFn: (input: unknown) => save(input),
    retry: false,
  });
  const branchMutation = useMutation({
    mutationFn: (input: unknown) => saveBranch(input),
    retry: false,
  });
  async function change(input: Partial<Preferences>) {
    if (lock.current) return;
    lock.current = true;
    const previous = preferences;
    setPreferences({ ...preferences, ...input });
    setError("");
    try {
      const result = await mutation.mutateAsync(input);
      if (!result.ok) throw new Error("Preference save failed.");
      setPreferences(result.data);
      applyChatPreferences(client, result.data);
      if (input.reminderMinutes !== undefined)
        void client.invalidateQueries({ queryKey: NOTIFICATION_SUMMARY_KEY });
      toast.success("저장했어요");
      router.refresh();
    } catch {
      setPreferences(previous);
      setError("저장하지 못했어요. 다시 시도해 주세요");
    } finally {
      lock.current = false;
    }
  }
  return (
    <div className="grid items-start gap-5 lg:grid-cols-2">
      <div className="space-y-5">
        <SettingsCard
          title="기본 지점"
          description="홈, 공간 예약, 지금 빈 공간이 이 지점으로 열려요."
        >
          <Label htmlFor={`${id}-branch`}>기본 지점</Label>
          <Select
            value={branchId ?? ""}
            disabled={branchMutation.isPending || data.branches.length === 0}
            onValueChange={async (next) => {
              if (branchLock.current) return;
              branchLock.current = true;
              const previous = branchId;
              setBranchId(next);
              setBranchError("");
              try {
                const result = await branchMutation.mutateAsync({
                  branchId: next,
                });
                if (!result.ok) throw new Error("Branch save failed.");
                toast.success("저장했어요");
                router.refresh();
              } catch {
                setBranchId(previous);
                setBranchError("저장하지 못했어요. 다시 시도해 주세요");
              } finally {
                branchLock.current = false;
              }
            }}
          >
            <SelectTrigger id={`${id}-branch`} className="w-full">
              <SelectValue placeholder="지점을 골라 주세요">
                {data.branches.find((branch) => branch.id === branchId)?.name}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {data.branches.map((branch) => (
                <SelectItem key={branch.id} value={branch.id}>
                  {branch.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {data.branches.length === 0 && (
            <p className="text-sm text-muted-foreground">아직 지점이 없어요</p>
          )}
          {branchError && (
            <p role="alert" className="text-sm text-destructive">
              {branchError}
            </p>
          )}
        </SettingsCard>
        <SettingsCard title="채팅">
          {(
            [
              ["chatToasts", "멘션과 DM 토스트"],
              ["tabBadge", "탭 제목에 안 읽은 수"],
            ] as const
          ).map(([key, label]) => (
            <div
              key={key}
              className="flex min-h-11 items-center justify-between gap-4"
            >
              <Label htmlFor={`${id}-${key}`}>{label}</Label>
              <Switch
                id={`${id}-${key}`}
                checked={preferences[key]}
                disabled={mutation.isPending}
                onCheckedChange={(checked) => void change({ [key]: checked })}
              />
            </div>
          ))}
        </SettingsCard>
      </div>
      <SettingsCard
        title="예약 미리 알림"
        description="이미 잡힌 예약에도 바로 적용돼요. 메일·푸시 알림은 아직 없어요."
      >
        {[30, 10, 5, 0].map((minute) => (
          <div
            key={minute}
            className="flex min-h-11 items-center justify-between gap-4"
          >
            <Label htmlFor={`${id}-minute-${minute}`} className="tabular-nums">
              {minute ? `${minute}분 전` : "시작할 때"}
            </Label>
            <Switch
              id={`${id}-minute-${minute}`}
              checked={preferences.reminderMinutes.includes(minute)}
              disabled={mutation.isPending}
              onCheckedChange={(checked) =>
                void change({
                  reminderMinutes: checked
                    ? [...preferences.reminderMinutes, minute]
                    : preferences.reminderMinutes.filter(
                        (value) => value !== minute,
                      ),
                })
              }
            />
          </div>
        ))}
      </SettingsCard>
      {error && (
        <p role="alert" className="text-sm text-destructive lg:col-span-2">
          {error}
        </p>
      )}
    </div>
  );
}
