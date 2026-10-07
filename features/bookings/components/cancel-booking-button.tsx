"use client";

import { useState } from "react";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cancelBooking } from "@/features/bookings/actions";
import { useBookingMutation } from "./use-booking-mutation";

export function CancelBookingButton({ bookingId }: { bookingId: string }) {
  const [open, setOpen] = useState(false);
  const mutation = useBookingMutation({
    action: cancelBooking,
    successMessage: "예약을 취소했어요",
    onSuccess: () => setOpen(false),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="text-destructive"
          disabled={mutation.pending}
          data-cancelling={mutation.pending && open ? "true" : undefined}
        >
          취소
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>이 예약을 취소할까요?</DialogTitle>
          <DialogDescription>
            취소한 예약은 되돌릴 수 없어요. 필요하면 다시 예약해 주세요.
          </DialogDescription>
        </DialogHeader>
        <p role="status" aria-live="polite">
          {mutation.message}
        </p>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={mutation.pending}
            onClick={() => setOpen(false)}
          >
            돌아가기
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={mutation.pending}
            onClick={() => void mutation.submit({ bookingId })}
            className="min-w-28"
          >
            {mutation.pending && (
              <LoaderCircle
                aria-hidden="true"
                className="animate-spin motion-reduce:animate-none"
              />
            )}
            {mutation.pending ? "취소하고 있어요" : "예약 취소"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
