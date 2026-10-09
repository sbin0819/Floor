"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatBookingTime } from "@/features/bookings/format";
import { cancelBookingAsOperator } from "../booking-actions";
import {
  cancellationPresets,
  cancelBookingAsOperatorSchema,
} from "../booking-schema";
import type { AdminBookingRow } from "../booking-types";
import { useAdminMutation } from "./use-admin-mutation";

export function OperatorCancelDialog({
  row,
  timezone,
  open,
  onOpenChange,
  onReturnFocus,
}: {
  row: AdminBookingRow;
  timezone: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReturnFocus?: () => void;
}) {
  const id = useId();
  const [preset, setPreset] = useState<
    (typeof cancellationPresets)[number] | ""
  >("");
  const [text, setText] = useState("");
  const mutation = useAdminMutation({
    action: cancelBookingAsOperator,
    onSuccess: () => onOpenChange(false),
    successMessage: "예약을 취소했어요. 예약자와 참석자에게 알렸어요",
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!mutation.pending) onOpenChange(next);
      }}
    >
      <DialogContent
        onCloseAutoFocus={(event) => {
          if (onReturnFocus) {
            event.preventDefault();
            onReturnFocus();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>예약을 취소할까요?</DialogTitle>
          <DialogDescription>
            {row.spaceName} · {formatBookingTime(row.start, row.end, timezone)}{" "}
            · {row.bookerName}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void mutation.submit(cancelBookingAsOperatorSchema, {
              bookingId: row.id,
              preset,
              text,
            });
          }}
        >
          <div className="space-y-2">
            <Label htmlFor={`${id}-preset`}>취소 이유</Label>
            <Select
              value={preset}
              onValueChange={(value) =>
                setPreset(value as (typeof cancellationPresets)[number])
              }
              disabled={mutation.pending}
            >
              <SelectTrigger
                id={`${id}-preset`}
                aria-invalid={!!mutation.errors.preset}
                aria-describedby={
                  mutation.errors.preset ? `${id}-preset-error` : undefined
                }
                className="min-h-11 w-full"
              >
                <SelectValue placeholder="이유를 골라 주세요">
                  {preset || undefined}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {cancellationPresets.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {mutation.errors.preset && (
              <p id={`${id}-preset-error`} className="text-sm text-destructive">
                이유를 골라 주세요
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-text`}>덧붙일 내용 (선택)</Label>
            <Textarea
              id={`${id}-text`}
              value={text}
              onChange={(event) => setText(event.target.value)}
              disabled={mutation.pending}
              aria-invalid={!!mutation.errors.text}
              aria-describedby={`${id}-text-help`}
            />
            <p
              id={`${id}-text-help`}
              className={
                mutation.errors.text
                  ? "text-sm text-destructive"
                  : "text-xs text-muted-foreground"
              }
            >
              {mutation.errors.text ??
                `최대 ${200 - (Array.from(preset || cancellationPresets[0]).length + 3)}자 · 예약자와 참석자에게 보여요`}
            </p>
          </div>
          <div className="space-y-1 text-sm text-muted-foreground">
            <p>
              예약자와 참석자 {row.participantCount + 1}명에게 &apos;운영자가
              예약을 취소했어요&apos; 알림이 가요
            </p>
            {row.spaceType !== "desk" && (
              <p>회의 채널에 취소 기록이 남고 읽기 전용이 돼요</p>
            )}
          </div>
          {mutation.message && (
            <p role="alert" className="text-sm text-destructive">
              {mutation.message}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={mutation.pending}
              onClick={() => onOpenChange(false)}
            >
              돌아가기
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={mutation.pending}
            >
              {mutation.pending ? "취소하는 중…" : "예약 취소"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
