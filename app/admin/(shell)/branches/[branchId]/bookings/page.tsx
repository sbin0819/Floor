import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireOperatorPage } from "@/lib/auth/session";
import { ActionError } from "@/lib/actions/result";
import { getAdminBookings } from "@/features/admin/queries";
import { adminBookingsSchema } from "@/features/admin/booking-query-factory";
import {
  AdminBookings,
  AdminBookingsFrame,
  AdminBookingsSkeleton,
} from "@/features/admin/components/admin-bookings";
import { AdminForbidden } from "@/features/admin/components/admin-forbidden";

type Props = {
  params: Promise<{ branchId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};
async function BookingsContent({ params, searchParams }: Props) {
  await requireOperatorPage();
  const [{ branchId }, search] = await Promise.all([params, searchParams]);
  const input = adminBookingsSchema.safeParse({
    branchId,
    date: search.date,
    days: typeof search.days === "string" ? Number(search.days) : search.days,
    floorId: search.floor,
    type: search.type,
    status: search.status,
    q: search.q,
    page: typeof search.page === "string" ? Number(search.page) : search.page,
  });
  if (!input.success)
    return (
      <AdminBookingsFrame>
        <p role="alert">날짜와 검색 조건을 확인해 주세요</p>
      </AdminBookingsFrame>
    );
  const data = await getAdminBookings(input.data).catch((error: unknown) => {
    if (error instanceof ActionError && error.code === "NOT_FOUND") notFound();
    if (error instanceof ActionError && error.code === "FORBIDDEN") return null;
    throw error;
  });
  return data ? <AdminBookings data={data} /> : <AdminForbidden />;
}
export default function AdminBookingsPage(props: Props) {
  return (
    <Suspense fallback={<AdminBookingsSkeleton />}>
      <BookingsContent {...props} />
    </Suspense>
  );
}
