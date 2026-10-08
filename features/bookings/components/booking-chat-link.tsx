"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { bookingMeetingHref } from "../meeting-navigation";

export function BookingChatLink({ bookingId }: { bookingId: string }) {
  const search = useSearchParams();
  return (
    <>
      <Button asChild variant="outline" className="hidden md:inline-flex">
        <Link
          href={bookingMeetingHref(search, bookingId)}
          scroll={false}
          data-chat-link={bookingId}
        >
          <MessageSquare aria-hidden="true" className="size-4" />
          채팅
        </Link>
      </Button>
      <Button asChild variant="outline" className="md:hidden">
        <Link href={`/m/${bookingId}`} data-chat-link={bookingId}>
          <MessageSquare aria-hidden="true" className="size-4" />
          채팅
        </Link>
      </Button>
    </>
  );
}
