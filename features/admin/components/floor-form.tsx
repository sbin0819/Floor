"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { createFloor, updateFloor } from "@/features/admin/actions";
import { createFloorSchema, updateFloorSchema } from "@/features/admin/schema";
import type { FloorSummary } from "@/features/bookings/types";
import { Field, fieldAria, FormMessage } from "./form-fields";
import { useAdminMutation } from "./use-admin-mutation";

export function FloorForm({
  branchId,
  floor,
  canManage = true,
  onSaved,
}: {
  branchId: string;
  floor?: FloorSummary;
  canManage?: boolean;
  onSaved?: () => void;
}) {
  const id = useId();
  const [name, setName] = useState(floor?.name ?? "");
  const [level, setLevel] = useState(String(floor?.level ?? ""));
  const [sortOrder, setSortOrder] = useState(String(floor?.sortOrder ?? ""));
  const mutation = useAdminMutation({
    action: floor ? updateFloor : createFloor,
    onSuccess: onSaved,
  });
  const disabled = !canManage || mutation.pending;
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (disabled) return;
        const values = {
          name,
          level: level === "" ? undefined : Number(level),
          ...(sortOrder === "" ? {} : { sortOrder: Number(sortOrder) }),
        };
        void mutation.submit(
          floor ? updateFloorSchema : createFloorSchema,
          floor ? { floorId: floor.id, ...values } : { branchId, ...values },
        );
      }}
    >
      {!canManage && (
        <p className="text-muted-foreground">
          읽기 전용이에요. 층 정보를 고칠 권한이 없어요
        </p>
      )}
      <Field id={`${id}-level`} label="층 번호" error={mutation.errors.level}>
        <Input
          id={`${id}-level`}
          type="number"
          className="tabular-nums"
          value={level}
          onChange={(event) => setLevel(event.target.value)}
          disabled={disabled}
          {...fieldAria(`${id}-level`, mutation.errors.level)}
        />
      </Field>
      <Field id={`${id}-name`} label="층 이름" error={mutation.errors.name}>
        <Input
          id={`${id}-name`}
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={20}
          disabled={disabled}
          {...fieldAria(`${id}-name`, mutation.errors.name)}
        />
      </Field>
      <Field id={`${id}-order`} label="순서" error={mutation.errors.sortOrder}>
        <Input
          id={`${id}-order`}
          type="number"
          className="tabular-nums"
          value={sortOrder}
          onChange={(event) => setSortOrder(event.target.value)}
          placeholder={floor ? undefined : "비우면 마지막 순서에 더해요"}
          disabled={disabled}
          {...fieldAria(`${id}-order`, mutation.errors.sortOrder)}
        />
      </Field>
      <FormMessage message={mutation.message} />
      <Button type="submit" disabled={disabled}>
        {mutation.pending
          ? "저장하고 있어요"
          : floor
            ? "층 정보 저장"
            : "층 더하기"}
      </Button>
    </form>
  );
}
export function AddFloorDialog({
  branchId,
  disabled,
}: {
  branchId: string;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button disabled={disabled}>층 더하기</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>층 더하기</DialogTitle>
          <DialogDescription>층 번호와 이름을 입력해 주세요</DialogDescription>
        </DialogHeader>
        <FloorForm
          key={branchId}
          branchId={branchId}
          onSaved={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
