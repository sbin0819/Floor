"use client";

import { useId, useState } from "react";
import { ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import type { MaintenanceDraft } from "../maintenance-navigation";
import type { MaintenanceSpaceOption } from "../maintenance-types";

export function MaintenanceFields({
  draft,
  spaces,
  editing,
  pending,
  errors,
  onChange,
}: {
  draft: MaintenanceDraft;
  spaces: MaintenanceSpaceOption[];
  editing: boolean;
  pending: boolean;
  errors: Record<string, string>;
  onChange: (change: Partial<MaintenanceDraft>) => void;
}) {
  const id = useId();
  const [spaceOpen, setSpaceOpen] = useState(false);
  const selected = spaces.find((space) => space.id === draft.spaceId);
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor={`${id}-space`}>공간</Label>
        <Popover open={spaceOpen} onOpenChange={setSpaceOpen}>
          <PopoverTrigger asChild>
            <Button
              id={`${id}-space`}
              variant="outline"
              role="combobox"
              aria-expanded={spaceOpen}
              aria-invalid={!!errors.spaceId}
              aria-describedby={
                errors.spaceId ? `${id}-space-error` : undefined
              }
              disabled={editing || pending}
              className="w-full justify-between"
            >
              <span className="truncate">
                {selected
                  ? `${selected.floorName} · ${selected.name}`
                  : "공간을 골라 주세요"}
              </span>
              <ChevronsUpDown className="size-4 shrink-0" aria-hidden="true" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="w-[var(--radix-popover-trigger-width)] p-0"
            align="start"
          >
            <Command label="층 · 공간 이름으로 찾기">
              <CommandInput
                placeholder="층 · 공간 이름으로 찾기"
                aria-label="층 · 공간 이름으로 찾기"
              />
              <CommandList>
                <CommandEmpty>찾는 공간이 없어요</CommandEmpty>
                {spaces.map((space) => (
                  <CommandItem
                    key={space.id}
                    value={`${space.floorName} ${space.name} ${space.id}`}
                    data-checked={space.id === draft.spaceId}
                    onSelect={() => {
                      onChange({ spaceId: space.id });
                      setSpaceOpen(false);
                    }}
                  >
                    {space.floorName} · {space.name}
                  </CommandItem>
                ))}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        {errors.spaceId && (
          <p id={`${id}-space-error`} className="text-sm text-destructive">
            {errors.spaceId}
          </p>
        )}
      </div>
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <div className="min-w-0 space-y-2">
          <Label htmlFor={`${id}-start`}>시작</Label>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.startKind === "now"}
              disabled={pending}
              onChange={(event) =>
                onChange({ startKind: event.target.checked ? "now" : "at" })
              }
              className="size-4 accent-primary"
            />
            지금 시작
          </label>
          <Input
            id={`${id}-start`}
            type="datetime-local"
            step={1800}
            value={draft.startAt}
            onChange={(event) => onChange({ startAt: event.target.value })}
            disabled={pending || draft.startKind === "now"}
            aria-invalid={!!errors.start}
            aria-describedby={errors.start ? `${id}-start-error` : undefined}
            className="min-w-0 tabular-nums"
          />
          {errors.start && (
            <p id={`${id}-start-error`} className="text-sm text-destructive">
              {errors.start}
            </p>
          )}
        </div>
        <div className="min-w-0 space-y-2">
          <Label htmlFor={`${id}-end`}>끝</Label>
          <p className="flex min-h-11 items-center text-xs text-muted-foreground">
            30분 단위로 정해요
          </p>
          <Input
            id={`${id}-end`}
            type="datetime-local"
            step={1800}
            value={draft.end}
            onChange={(event) => onChange({ end: event.target.value })}
            disabled={pending}
            aria-invalid={!!errors.end}
            aria-describedby={errors.end ? `${id}-end-error` : undefined}
            className="min-w-0 tabular-nums"
          />
          {errors.end && (
            <p id={`${id}-end-error`} className="text-sm text-destructive">
              {errors.end}
            </p>
          )}
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${id}-reason`}>이유 (멤버에게 보여요)</Label>
        <Textarea
          id={`${id}-reason`}
          value={draft.reason}
          onChange={(event) => onChange({ reason: event.target.value })}
          disabled={pending}
          aria-invalid={!!errors.reason}
          aria-describedby={`${id}-reason-help`}
        />
        <p
          id={`${id}-reason-help`}
          className={
            errors.reason
              ? "text-sm text-destructive"
              : "text-xs text-muted-foreground"
          }
        >
          {errors.reason ?? "1–100자로 적어 주세요"}
        </p>
      </div>
    </>
  );
}
