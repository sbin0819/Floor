"use client";

import { useId, type ComponentProps } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function TeamInput({
  label,
  error,
  hint,
  ...props
}: ComponentProps<typeof Input> & {
  label: string;
  error?: string;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        {...props}
        id={id}
        className={`h-11 ${props.className ?? ""}`}
        aria-invalid={!!error}
        aria-describedby={
          [error && `${id}-error`, hint && `${id}-hint`]
            .filter(Boolean)
            .join(" ") || undefined
        }
      />
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-xs text-muted-foreground">
          {error}
        </p>
      )}
    </div>
  );
}

export function TeamMessage({
  label = "메시지 (선택)",
  error,
  ...props
}: ComponentProps<typeof Textarea> & { label?: string; error?: string }) {
  const id = useId();
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        {...props}
        name="message"
        id={id}
        maxLength={200}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      {error && (
        <p id={`${id}-error`} className="text-xs text-muted-foreground">
          {error}
        </p>
      )}
    </div>
  );
}

export function BranchSelect({
  branches,
  value,
  onValueChange,
  error,
  disabled,
}: {
  branches: { id: string; name: string }[];
  value: string;
  onValueChange: (value: string) => void;
  error?: string;
  disabled: boolean;
}) {
  const id = useId();
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>주 이용 지점</Label>
      <Select value={value} onValueChange={onValueChange} disabled={disabled}>
        <SelectTrigger
          id={id}
          className="h-11 w-full"
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
        >
          <SelectValue placeholder="지점을 선택해 주세요">
            {branches.find((branch) => branch.id === value)?.name}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {branches.map((branch) => (
            <SelectItem className="min-h-11" key={branch.id} value={branch.id}>
              {branch.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error && (
        <p id={`${id}-error`} className="text-xs text-muted-foreground">
          {error}
        </p>
      )}
    </div>
  );
}

export function TeamFeedback({ message }: { message: string }) {
  return (
    <div aria-live="polite" aria-atomic="true">
      {message && (
        <p className="rounded-lg border border-border bg-muted p-3 text-sm">
          {message}
        </p>
      )}
    </div>
  );
}
