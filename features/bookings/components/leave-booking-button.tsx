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
import { leaveBooking } from "@/features/bookings/actions";
import { useBookingMutation } from "./use-booking-mutation";

export function LeaveBookingButton({ bookingId }: { bookingId: string }) {
  const [open, setOpen] = useState(false);
  const mutation = useBookingMutation({
    action: leaveBooking,
    successMessage: "참석자에서 빠졌어요",
    onSuccess: () => setOpen(false),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          disabled={mutation.pending}
          data-cancelling={mutation.pending && open ? "true" : undefined}
        >
          참석 안 함
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>이 예약에 참석하지 않을까요?</DialogTitle>
          <DialogDescription>예약한 사람에게 알려요</DialogDescription>
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
            {mutation.pending ? "처리하고 있어요" : "참석 안 함"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
