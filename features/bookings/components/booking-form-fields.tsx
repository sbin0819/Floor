"use client";

import { cn } from "cn";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type BookingFormVariant = "panel" | "strip";
type Option = { value: string; label: string };

function TimeSelect({
  id,
  label,
  value,
  disabled,
  onChange,
  options,
  error,
}: {
  id: string;
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  options: Option[];
  error?: string;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={value}
        onValueChange={(next) => {
          // 종료 옵션이 새로 생길 때 네이티브 폼 동기화가 보내는 빈 값은 선택이 아니다.
          if (options.some((option) => option.value === next)) onChange(next);
        }}
        disabled={disabled}
      >
        <SelectTrigger
          id={id}
          className="min-h-11 w-full tabular-nums"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
        >
          <SelectValue placeholder={`${label} 시각 선택`}>
            {options.find((option) => option.value === value)?.label}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem
              className="min-h-11 tabular-nums"
              key={option.value}
              value={option.value}
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error && (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export function BookingTimeFields({
  id,
  variant,
  start,
  end,
  disabled,
  startOptions,
  endOptions,
  startError,
  endError,
  onStartChange,
  onEndChange,
}: {
  id: string;
  variant: BookingFormVariant;
  start: string;
  end: string;
  disabled: boolean;
  startOptions: Option[];
  endOptions: Option[];
  startError?: string;
  endError?: string;
  onStartChange: (value: string) => void;
  onEndChange: (value: string) => void;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-3",
        variant === "strip" && "col-span-2 min-w-56 lg:flex-1",
      )}
    >
      <TimeSelect
        id={`${id}-start`}
        label="시작"
        value={start}
        disabled={disabled}
        onChange={onStartChange}
        options={startOptions}
        error={startError}
      />
      <TimeSelect
        id={`${id}-end`}
        label="끝"
        value={end}
        disabled={disabled || !start}
        onChange={onEndChange}
        options={endOptions}
        error={endError}
      />
    </div>
  );
}

export function BookingTitleField({
  id,
  variant,
  value,
  disabled,
  errors,
  onChange,
}: {
  id: string;
  variant: BookingFormVariant;
  value: string;
  disabled: boolean;
  errors?: string[];
  onChange: (value: string) => void;
}) {
  return (
    <div className={cn("space-y-1", variant === "strip" && "min-w-32 flex-1")}>
      <Label htmlFor={`${id}-title`}>제목 (선택)</Label>
      <Input
        id={`${id}-title`}
        value={value}
        maxLength={60}
        disabled={disabled}
        aria-invalid={Boolean(errors)}
        aria-describedby={errors ? `${id}-title-error` : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {errors && (
        <p id={`${id}-title-error`} className="text-xs text-destructive">
          {errors[0]}
        </p>
      )}
    </div>
  );
}

export function BookingActorField({
  id,
  variant,
  value,
  label,
  options,
  disabled,
  onChange,
}: {
  id: string;
  variant: BookingFormVariant;
  value: string;
  label?: string;
  options: Option[];
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div
      className={cn(
        variant === "strip" ? "min-w-32 space-y-1" : "min-w-0 flex-1",
      )}
    >
      <Label
        htmlFor={`${id}-actor`}
        className={variant === "panel" ? "sr-only" : undefined}
      >
        예약 방식
      </Label>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger id={`${id}-actor`} className="min-h-11 w-full">
          <SelectValue placeholder="예약 방식 선택">{label}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((item) => (
            <SelectItem
              className="min-h-11"
              key={item.value}
              value={item.value}
            >
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
