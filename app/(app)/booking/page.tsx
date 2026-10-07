import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requirePageSession } from "@/lib/auth/session";
import { getBookingDestination } from "@/features/bookings/queries";
import { FloorPageSkeleton } from "@/features/bookings/components/booking-skeletons";

type Props = {
  searchParams?: Promise<{ date?: string | string[] }>;
};
async function BookingContent({ searchParams }: Props) {
  const date = (await searchParams)?.date;
  const query = new URLSearchParams();
  if (typeof date === "string") query.set("date", date);
  await requirePageSession(`/booking${query.size ? `?${query}` : ""}`);
  return redirect(await getBookingDestination(date));
}
export default function BookingPage(props: Props = {}) {
  return (
    <Suspense fallback={<FloorPageSkeleton />}>
      <BookingContent {...props} />
    </Suspense>
  );
}
