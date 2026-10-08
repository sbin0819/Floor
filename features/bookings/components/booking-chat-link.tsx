"use client";

import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";

export function BookingChatLink({ bookingId }: { bookingId: string }) {
  return (
    <Button asChild variant="outline">
      <Link href={`/m/${bookingId}`} data-chat-link={bookingId}>
        <MessageSquare aria-hidden="true" className="size-4" />
        채팅
      </Link>
    </Button>
  );
}
