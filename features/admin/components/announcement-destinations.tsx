"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  AnnouncementsData,
  LoungeAvailability,
} from "../announcement-types";

export type AnnouncementDestinationDraft = {
  lounge: boolean;
  audience: boolean;
  date: string;
  floorId: string;
  spaceId: string;
};
export function loungeUnavailableMessage(reason: LoungeAvailability["reason"]) {
  if (reason === "banned") return "이 라운지에서 내보내져 공지를 쓸 수 없어요";
  if (reason === "space_limit")
    return "참여한 스페이스가 100개라 라운지에 참여할 수 없어요";
  return "라운지에 # 공지 채널이 없어요";
}
export function AnnouncementDestinations({
  data,
  draft,
  lounge,
  count,
  busy,
  onChange,
}: {
  data: AnnouncementsData;
  draft: AnnouncementDestinationDraft;
  lounge: LoungeAvailability;
  count: number | null;
  busy: boolean;
  onChange: (next: AnnouncementDestinationDraft) => void;
}) {
  const floor = data.floors.find((value) => value.id === draft.floorId);
  const space = floor?.spaces.find((value) => value.id === draft.spaceId);
  const box =
    "rounded-lg border p-4 has-[:checked]:border-primary has-[:checked]:bg-accent/50";
  return (
    <fieldset disabled={busy} className="space-y-3">
      <legend className="mb-3 text-sm font-semibold">받는 곳</legend>
      <div className={box}>
        <label className="flex min-h-11 cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            className="size-5 shrink-0 accent-primary"
            checked={draft.lounge}
            disabled={!lounge.available}
            onChange={(event) =>
              onChange({ ...draft, lounge: event.target.checked })
            }
            aria-describedby="announcement-lounge-hint"
          />
          <span className="text-sm font-semibold">
            {data.branch.name} 라운지 # 공지
          </span>
        </label>
        <p
          id="announcement-lounge-hint"
          className="pl-8 text-xs leading-6 text-muted-foreground"
        >
          {lounge.available ? (
            <>
              라운지에 참여한{" "}
              <span className="tabular-nums">{lounge.memberCount}명</span>이
              봐요 · @모두 알림
            </>
          ) : (
            loungeUnavailableMessage(lounge.reason)
          )}
        </p>
      </div>
      <div className={box}>
        <label className="flex min-h-11 cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            className="size-5 shrink-0 accent-primary"
            checked={draft.audience}
            onChange={(event) =>
              onChange({ ...draft, audience: event.target.checked })
            }
          />
          <span className="text-sm font-semibold">예약한 사람에게 알림</span>
        </label>
        {draft.audience && (
          <div className="space-y-3 pt-2 sm:pl-8">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label htmlFor="announcement-date">날짜</Label>
                <Input
                  id="announcement-date"
                  type="date"
                  className="min-w-0 tabular-nums"
                  min={data.today}
                  max={data.maxDate}
                  value={draft.date}
                  onChange={(event) =>
                    onChange({ ...draft, date: event.target.value })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="announcement-floor">층</Label>
                <Select
                  value={draft.floorId || "all"}
                  onValueChange={(value) =>
                    onChange({
                      ...draft,
                      floorId: value === "all" ? "" : value,
                      spaceId: "",
                    })
                  }
                >
                  <SelectTrigger id="announcement-floor" className="w-full">
                    <SelectValue>{floor?.name ?? "모든 층"}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">모든 층</SelectItem>
                    {data.floors.map((row) => (
                      <SelectItem key={row.id} value={row.id}>
                        {row.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="announcement-space">공간</Label>
                <Select
                  disabled={!floor}
                  value={draft.spaceId || "all"}
                  onValueChange={(value) =>
                    onChange({
                      ...draft,
                      spaceId: value === "all" ? "" : value,
                    })
                  }
                >
                  <SelectTrigger id="announcement-space" className="w-full">
                    <SelectValue>{space?.name ?? "모든 공간"}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">모든 공간</SelectItem>
                    {floor?.spaces.map((row) => (
                      <SelectItem key={row.id} value={row.id}>
                        {row.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p
              role="status"
              aria-live="polite"
              className="text-xs leading-6 text-muted-foreground"
            >
              {count === null ? (
                "받는 사람 수를 확인하고 있어요"
              ) : (
                <>
                  그날 확정 예약이 있는 예약자와 참석자{" "}
                  <span className="tabular-nums">{count}명</span>
                </>
              )}
            </p>
          </div>
        )}
      </div>
    </fieldset>
  );
}
