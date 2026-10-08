import { formatBookingTime } from "./format";
import type { BookingParticipantDraft } from "./participants";

export type BookingEditDraft = {
  start: string;
  end: string;
  title: string;
  attendeeCount: number | null;
  participants: BookingParticipantDraft[];
};

export function sameBookingEdit(a: BookingEditDraft, b: BookingEditDraft) {
  return (
    Date.parse(a.start) === Date.parse(b.start) &&
    Date.parse(a.end) === Date.parse(b.end) &&
    a.title === b.title &&
    a.attendeeCount === b.attendeeCount &&
    JSON.stringify(a.participants.map(({ userId }) => userId).sort()) ===
      JSON.stringify(b.participants.map(({ userId }) => userId).sort())
  );
}

export function editTimeOptions(
  options: { value: string; label: string }[],
  preserved: string[],
  start: string,
  timezone: string,
  edge: "start" | "end",
) {
  const values = new Map(
    options.map((option) => [Date.parse(option.value), option]),
  );
  for (const value of preserved) {
    if (!value) continue;
    values.set(Date.parse(value), {
      value,
      label: formatBookingTime(
        edge === "start" ? value : start,
        value,
        timezone,
      ).split("–")[edge === "start" ? 0 : 1]!,
    });
  }
  return [...values.values()].sort(
    (a, b) => Date.parse(a.value) - Date.parse(b.value),
  );
}

export function editParticipantsPayload(
  participants: BookingParticipantDraft[],
  participantIdsAtLoad: readonly string[],
) {
  const original = new Set(participantIdsAtLoad);
  return participants.map(({ userId, sharedTeamNames, email }) => ({
    userId,
    ...(!original.has(userId) && sharedTeamNames.length === 0 && email
      ? { email }
      : {}),
  }));
}
