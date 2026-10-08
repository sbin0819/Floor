"use client";

import { useId } from "react";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { spaceIconColors, type SpaceIconColor } from "../space-schema";

export const spaceColorClasses: Record<SpaceIconColor, string> = {
  blue: "bg-space-icon-blue",
  green: "bg-space-icon-green",
  orange: "bg-space-icon-orange",
  purple: "bg-space-icon-purple",
  pink: "bg-space-icon-pink",
  teal: "bg-space-icon-teal",
  yellow: "bg-space-icon-yellow",
  gray: "bg-space-icon-gray",
};
export const spaceColorNames: Record<SpaceIconColor, string> = {
  blue: "파랑",
  green: "초록",
  orange: "주황",
  purple: "보라",
  pink: "분홍",
  teal: "청록",
  yellow: "노랑",
  gray: "회색",
};
export function SpaceColorPicker({
  value,
  onChange,
  disabled,
}: {
  value: SpaceIconColor;
  onChange: (color: SpaceIconColor) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold">색</legend>
      <RadioGroup
        aria-label="스페이스 색"
        value={value}
        onValueChange={(color) => {
          if (spaceIconColors.includes(color as SpaceIconColor))
            onChange(color as SpaceIconColor);
        }}
        disabled={disabled}
        className="grid-cols-4 sm:grid-cols-8"
      >
        {spaceIconColors.map((color) => (
          <Label
            key={color}
            className="flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-border p-3"
            htmlFor={`${id}-${color}`}
          >
            <RadioGroupItem
              id={`${id}-${color}`}
              value={color}
              aria-label={spaceColorNames[color]}
              className={`${spaceColorClasses[color]} size-5`}
            />
          </Label>
        ))}
      </RadioGroup>
    </fieldset>
  );
}
