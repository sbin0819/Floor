"use client";

import { Fragment, useId } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { dayKeys, type DayKey, type OpenHours } from "@/lib/time/open-hours";
import { SLOT_MINUTES } from "@/lib/time/zoned";
import { ChoiceSelect } from "./form-fields";

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
export function applyMondayToWeekdays(
  value: Required<OpenHours>,
): Required<OpenHours> {
  const monday = value.mon;
  return {
    ...value,
    ...Object.fromEntries(
      ["tue", "wed", "thu", "fri"].map((day) => [
        day,
        monday === null ? null : { ...monday },
      ]),
    ),
  };
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
    <fieldset className="min-w-0 space-y-4">
      <legend className="mb-3 text-lg font-semibold">운영 시간</legend>
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        onClick={() => onChange(applyMondayToWeekdays(value))}
      >
        월요일 시간을 평일 전체에 적용
      </Button>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[340px] border-collapse text-left text-sm">
          <caption className="sr-only">요일별 운영 시간</caption>
          <thead className="border-b border-border text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="py-3 pr-2 font-medium">
                요일
              </th>
              <th scope="col" className="px-2 py-3 font-medium">
                쉬는 날
              </th>
              <th scope="col" className="px-2 py-3 font-medium">
                시작
              </th>
              <th scope="col" className="py-3 pl-2 font-medium">
                끝
              </th>
            </tr>
          </thead>
          <tbody>
            {dayKeys.map((day) => {
              const hours = value[day];
              const error =
                errors[`openHours.${day}.close`] ??
                errors[`openHours.${day}.open`] ??
                errors[`openHours.${day}`] ??
                errors.openHours;
              return (
                <Fragment key={day}>
                  <tr className={error ? undefined : "border-b border-border"}>
                    <th
                      scope="row"
                      className="py-2 pr-2 font-medium whitespace-nowrap"
                    >
                      {dayNames[day]}
                    </th>
                    <td className="px-2 py-2">
                      <Switch
                        id={`${id}-${day}-closed`}
                        checked={hours === null}
                        disabled={disabled}
                        onCheckedChange={(closed) =>
                          onChange({
                            ...value,
                            [day]: closed
                              ? null
                              : { open: "09:00", close: "22:00" },
                          })
                        }
                      />
                      <Label
                        htmlFor={`${id}-${day}-closed`}
                        className="sr-only"
                      >
                        {dayNames[day]} 쉬는 날
                      </Label>
                    </td>
                    <td className="px-2 py-2 tabular-nums">
                      <Label htmlFor={`${id}-${day}-open`} className="sr-only">
                        {dayNames[day]} 시작
                      </Label>
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
                    </td>
                    <td className="py-2 pl-2 tabular-nums">
                      <Label htmlFor={`${id}-${day}-close`} className="sr-only">
                        {dayNames[day]} 끝
                      </Label>
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
                    </td>
                  </tr>
                  {error && (
                    <tr className="border-b border-border">
                      <td colSpan={4} className="pb-3 text-sm text-destructive">
                        <p id={`${id}-${day}-close-error`}>{error}</p>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </fieldset>
  );
}
