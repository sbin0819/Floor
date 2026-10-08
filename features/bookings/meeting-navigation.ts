type Search = Pick<URLSearchParams, "toString">;

export function bookingMeetingHref(search: Search, bookingId: string | null) {
  const query = new URLSearchParams(search.toString());
  query.delete("chat");
  if (bookingId !== null) query.append("chat", bookingId);
  const value = query.toString();
  return `/bookings${value ? `?${value}` : ""}`;
}

export function bookingCalendarSearchKey(search: Search) {
  const query = new URLSearchParams(search.toString());
  query.delete("chat");
  return query.toString();
}

export function bookingPageHref(
  query?: Record<string, string | string[] | undefined>,
) {
  const search = new URLSearchParams();
  if (query?.view === "calendar") {
    search.set("view", "calendar");
    for (const key of ["month", "day"] as const)
      if (typeof query[key] === "string") search.set(key, query[key]);
  } else if (query?.tab === "past") search.set("tab", "past");
  return bookingMeetingHref(
    search,
    typeof query?.chat === "string" ? query.chat : null,
  );
}

export function restoreBookingChatFocus(bookingId: string) {
  const visibleLink = [
    ...document.querySelectorAll<HTMLAnchorElement>("[data-chat-link]"),
  ].find(
    (link) =>
      link.dataset.chatLink === bookingId &&
      link.getClientRects().length > 0 &&
      getComputedStyle(link).visibility !== "hidden" &&
      !link.closest('[role="dialog"]'),
  );
  if (visibleLink) {
    visibleLink.focus();
    return;
  }
  const heading = [
    ...document.querySelectorAll<HTMLHeadingElement>("main h1"),
  ].find((node) => !node.closest('[role="dialog"]'));
  if (!heading) return;
  const previous = heading.getAttribute("tabindex");
  heading.setAttribute("tabindex", "-1");
  heading.focus();
  heading.addEventListener(
    "blur",
    () => {
      if (previous === null) heading.removeAttribute("tabindex");
      else heading.setAttribute("tabindex", previous);
    },
    { once: true },
  );
}
