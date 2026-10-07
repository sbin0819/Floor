"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { createSpace, updateSpace } from "@/features/admin/actions";
import { createSpaceSchema, updateSpaceSchema } from "@/features/admin/schema";
import type { AdminSpace } from "@/features/admin/types";
import { spaceTypeLabels } from "@/features/bookings/format";
import { amenityKeys, amenityLabels } from "@/lib/spaces/amenities";
import { ChoiceSelect, Field, fieldAria, FormMessage } from "./form-fields";
import { useAdminMutation } from "./use-admin-mutation";

const types = [
  "meeting_room",
  "seminar",
  "phone_booth",
  "desk_area",
  "lounge",
] as const;
export function SpaceForm({
  floorId,
  space,
  canManage,
  onSaved,
}: {
  floorId: string;
  space?: AdminSpace;
  canManage: boolean;
  onSaved?: () => void;
}) {
  const id = useId();
  const [type, setType] = useState<AdminSpace["type"]>(
    space?.type ?? "meeting_room",
  );
  const [name, setName] = useState(space?.name ?? "");
  const [capacity, setCapacity] = useState(String(space?.capacity ?? ""));
  const [bookable, setBookable] = useState(space?.bookable ?? true);
  const [amenities, setAmenities] = useState(space?.amenities ?? []);
  const mutation = useAdminMutation({
    action: space ? updateSpace : createSpace,
    onSuccess: onSaved,
  });
  const disabled = !canManage || mutation.pending;
  const supportsBooking = type !== "lounge" && type !== "desk_area";
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (disabled) return;
        const values = {
          name,
          capacity: capacity === "" ? null : Number(capacity),
          bookable: supportsBooking && bookable,
          amenities,
        };
        void mutation.submit(
          space
            ? updateSpaceSchema.refine(
                ({ capacity }) => type === "lounge" || capacity !== null,
                { path: ["capacity"], message: "정원을 입력해 주세요" },
              )
            : createSpaceSchema,
          space
            ? { spaceId: space.id, ...values }
            : { floorId, type, ...values },
        );
      }}
    >
      {!canManage && (
        <p className="text-muted-foreground">
          읽기 전용이에요. 공간 정보를 고칠 권한이 없어요
        </p>
      )}
      <Field id={`${id}-type`} label="종류">
        <ChoiceSelect
          id={`${id}-type`}
          value={type}
          options={types.map((value) => ({
            value,
            label: spaceTypeLabels[value],
          }))}
          disabled={disabled || Boolean(space)}
          onChange={(value) => {
            if (types.includes(value as AdminSpace["type"])) {
              setType(value as AdminSpace["type"]);
              if (value === "lounge" || value === "desk_area")
                setBookable(false);
            }
          }}
        />
      </Field>
      <Field id={`${id}-name`} label="공간 이름" error={mutation.errors.name}>
        <Input
          id={`${id}-name`}
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={40}
          disabled={disabled}
          {...fieldAria(`${id}-name`, mutation.errors.name)}
        />
      </Field>
      <Field
        id={`${id}-capacity`}
        label={`정원${type === "lounge" ? " (선택)" : ""}`}
        error={mutation.errors.capacity}
      >
        <Input
          id={`${id}-capacity`}
          type="number"
          className="tabular-nums"
          value={capacity}
          onChange={(event) => setCapacity(event.target.value)}
          disabled={disabled}
          {...fieldAria(`${id}-capacity`, mutation.errors.capacity)}
        />
      </Field>
      <div className="flex min-h-11 items-center gap-3">
        <Switch
          id={`${id}-bookable`}
          checked={supportsBooking && bookable}
          onCheckedChange={setBookable}
          disabled={disabled || !supportsBooking}
        />
        <Label htmlFor={`${id}-bookable`}>예약 가능</Label>
      </div>
      {!supportsBooking && (
        <p className="text-muted-foreground">
          {spaceTypeLabels[type]}은 예약 없이 이용해요
          {type === "desk_area" && space ? ` · 좌석 ${space.deskCount}석` : ""}
        </p>
      )}
      <fieldset>
        <legend className="mb-2 font-medium">편의 시설</legend>
        <div className="grid grid-cols-2 gap-2">
          {amenityKeys.map((key) => (
            <div key={key} className="flex min-h-11 items-center gap-3">
              <Switch
                id={`${id}-${key}`}
                checked={amenities.includes(key)}
                disabled={disabled}
                onCheckedChange={(checked) =>
                  setAmenities(
                    checked
                      ? [...amenities, key]
                      : amenities.filter((value) => value !== key),
                  )
                }
              />
              <Label htmlFor={`${id}-${key}`}>{amenityLabels[key]}</Label>
            </div>
          ))}
        </div>
      </fieldset>
      <FormMessage message={mutation.message} />
      <Button type="submit" disabled={disabled}>
        {mutation.pending
          ? "저장하고 있어요"
          : space
            ? "공간 정보 저장"
            : "공간 더하기"}
      </Button>
    </form>
  );
}
