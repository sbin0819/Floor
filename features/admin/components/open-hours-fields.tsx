"use client";

import { useId } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { dayKeys, type DayKey, type OpenHours } from "@/lib/time/open-hours";
import { SLOT_MINUTES } from "@/lib/time/zoned";
import { ChoiceSelect, Field } from "./form-fields";

const dayNames: Record<DayKey, string> = {
  mon: "월요일",
  tue: "화요일",
  wed: "수요일",
  thu: "목요일",
  fri: "금요일",
  sat: "토요일",
  sun: "일요일",
};
const timeOptions = Array.from(
  { length: (24 * 60) / SLOT_MINUTES + 1 },
  (_, index) => {
    const minutes = index * SLOT_MINUTES;
    const value = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    return { value, label: value };
  },
);
export function completeOpenHours(hours: OpenHours): Required<OpenHours> {
  return Object.fromEntries(
    dayKeys.map((day) => [
      day,
      hours[day] === null
        ? null
        : { ...(hours[day] ?? { open: "09:00", close: "22:00" }) },
    ]),
  ) as Required<OpenHours>;
}
export function OpenHoursFields({
  value,
  onChange,
  disabled,
  errors,
}: {
  value: Required<OpenHours>;
  onChange: (value: Required<OpenHours>) => void;
  disabled: boolean;
  errors: Record<string, string>;
}) {
  const id = useId();
  return (
    <fieldset className="space-y-4">
      <legend className="mb-3 font-semibold">운영 시간</legend>
      {dayKeys.map((day) => {
        const hours = value[day];
        const error =
          errors[`openHours.${day}.close`] ??
          errors[`openHours.${day}.open`] ??
          errors.openHours;
        return (
          <div
            key={day}
            className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[150px_1fr_1fr]"
          >
            <div className="space-y-2">
              <p className="font-medium">{dayNames[day]}</p>
              <div className="flex min-h-11 items-center gap-3">
                <Switch
                  id={`${id}-${day}-closed`}
                  checked={hours === null}
                  disabled={disabled}
                  onCheckedChange={(closed) =>
                    onChange({
                      ...value,
                      [day]: closed ? null : { open: "09:00", close: "22:00" },
                    })
                  }
                />
                <Label htmlFor={`${id}-${day}-closed`}>
                  {dayNames[day]} 쉬는 날
                </Label>
              </div>
            </div>
            <Field id={`${id}-${day}-open`} label={`${dayNames[day]} 시작`}>
              <ChoiceSelect
                id={`${id}-${day}-open`}
                value={hours?.open ?? "09:00"}
                options={timeOptions.slice(0, -1)}
                disabled={disabled || hours === null}
                onChange={(open) =>
                  onChange({
                    ...value,
                    [day]: { open, close: hours?.close ?? "22:00" },
                  })
                }
              />
            </Field>
            <Field
              id={`${id}-${day}-close`}
              label={`${dayNames[day]} 끝`}
              error={error}
            >
              <ChoiceSelect
                id={`${id}-${day}-close`}
                value={hours?.close ?? "22:00"}
                options={timeOptions.slice(1)}
                disabled={disabled || hours === null}
                error={error}
                onChange={(close) =>
                  onChange({
                    ...value,
                    [day]: { open: hours?.open ?? "09:00", close },
                  })
                }
              />
            </Field>
          </div>
        );
      })}
    </fieldset>
  );
}
