import { Suspense } from "react";
import { notFound } from "next/navigation";
import {
  BookingEditLayout,
  BookingEditSkeleton,
} from "@/features/bookings/components/booking-edit-layout";
import { BookingEditScreen } from "@/features/bookings/components/booking-edit-screen";
import { getBookingForEdit } from "@/features/bookings/queries";
import { ActionError } from "@/lib/actions/result";
import { requirePageSession } from "@/lib/auth/session";

type Props = { params: Promise<{ bookingId: string }> };

async function BookingEditContent({ params }: Props) {
  const { bookingId } = await params;
  await requirePageSession(`/bookings/${encodeURIComponent(bookingId)}/edit`);
  let data;
  try {
    data = await getBookingForEdit(bookingId);
  } catch (error) {
    if (error instanceof ActionError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  return <BookingEditScreen data={data} />;
}

export default function BookingEditPage(props: Props) {
  return (
    <BookingEditLayout>
      <Suspense fallback={<BookingEditSkeleton />}>
        <BookingEditContent {...props} />
      </Suspense>
    </BookingEditLayout>
  );
}
