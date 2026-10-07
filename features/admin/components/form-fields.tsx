"use client";

import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error && (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
export function fieldAria(id: string, error?: string) {
  return {
    "aria-invalid": Boolean(error),
    "aria-describedby": error ? `${id}-error` : undefined,
  };
}
export function FormMessage({ message }: { message: string }) {
  return (
    <p role="status" aria-live="polite" className="text-sm text-destructive">
      {message}
    </p>
  );
}
export function ChoiceSelect({
  id,
  value,
  onChange,
  options,
  disabled = false,
  error,
  placeholder = "선택해 주세요",
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
  error?: string;
  placeholder?: string;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (options.some((item) => item.value === next)) onChange(next);
      }}
      disabled={disabled}
    >
      <SelectTrigger
        id={id}
        className="min-h-11 w-full"
        {...fieldAria(id, error)}
      >
        <SelectValue placeholder={placeholder}>
          {options.find((option) => option.value === value)?.label}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            className="min-h-11"
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
