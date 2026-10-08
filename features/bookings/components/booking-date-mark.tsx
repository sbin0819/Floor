"use client";

import { use } from "react";

type BookingDates = string[] | Promise<string[]>;

function useBookingDates(source: BookingDates) {
  return Array.isArray(source) ? source : use(source);
}

export function BookingDateMark({
  source,
  date,
}: {
  source: BookingDates;
  date: string;
}) {
  return useBookingDates(source).includes(date) ? (
    <>
      <span className="sr-only">내 예약 있음</span>
      <span
        aria-hidden="true"
        className="block size-1 rounded-full bg-primary"
      />
    </>
  ) : null;
}

export function BookingDateLegend({ source }: { source: BookingDates }) {
  useBookingDates(source);
  return <>내 예약이 있는 날</>;
}
