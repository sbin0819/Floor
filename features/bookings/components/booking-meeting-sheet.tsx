"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  startTransition,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Expand, X } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  bookingMeetingHref,
  restoreBookingChatFocus,
} from "../meeting-navigation";

export function BookingMeetingSheetActions({
  bookingId,
}: {
  bookingId: string;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      {z.uuid().safeParse(bookingId).success && (
        <Button asChild variant="ghost" size="icon">
          <Link href={`/m/${bookingId}`} aria-label="크게 보기">
            <Expand aria-hidden="true" className="size-4" />
          </Link>
        </Button>
      )}
      <SheetClose asChild>
        <Button variant="ghost" size="icon" aria-label="회의 채팅 닫기">
          <X aria-hidden="true" className="size-4" />
        </Button>
      </SheetClose>
    </div>
  );
}

export function BookingMeetingPending({ bookingId }: { bookingId: string }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border p-3">
        <p className="font-semibold">예약 채팅</p>
        <BookingMeetingSheetActions bookingId={bookingId} />
      </div>
      <div
        role="status"
        aria-label="회의를 불러오고 있어요"
        className="flex flex-1 flex-col gap-4 p-4"
      >
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="mt-auto h-20 w-full" />
      </div>
    </div>
  );
}

export function BookingMeetingSheet({
  bookingId,
  children,
}: {
  bookingId: string | null;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const selected = search.has("chat")
    ? search.getAll("chat").length === 1
      ? search.get("chat")!
      : ""
    : null;
  const [dismissed, setDismissed] = useState<string | null>(null);
  const focusBooking = useRef(bookingId);
  useEffect(() => {
    if (bookingId !== null) focusBooking.current = bookingId;
  }, [bookingId]);
  if (dismissed !== null && selected === null) setDismissed(null);
  const open =
    pathname === "/bookings" && selected !== null && selected !== dismissed;
  const close = () => {
    if (selected === null) return;
    focusBooking.current = selected;
    setDismissed(selected);
    const href = bookingMeetingHref(search, null);
    startTransition(() => router.replace(href, { scroll: false }));
  };
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <SheetContent
        side="right"
        showCloseButton={false}
        className="max-w-full gap-0 overflow-hidden p-0 data-[side=right]:w-[420px] data-[side=right]:sm:max-w-none"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (pathname === "/bookings")
            restoreBookingChatFocus(focusBooking.current ?? "");
        }}
      >
        <SheetTitle className="sr-only">예약 채팅</SheetTitle>
        <SheetDescription className="sr-only">
          예약한 사람과 참석자의 회의 대화예요
        </SheetDescription>
        <div
          className="h-full min-h-0 overflow-hidden"
          data-booking-meeting-sheet
        >
          {selected === bookingId ? (
            children
          ) : (
            <BookingMeetingPending bookingId={selected ?? ""} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
