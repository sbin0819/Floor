import { ActionError } from "@/lib/actions/result";
import type { BookingParticipantInput } from "./participant-input";
import { MAX_GUEST_PARTICIPANTS } from "./participants";

export function invalidParticipants(): never {
  throw new ActionError("INVALID_INPUT", {
    fieldErrors: { participants: ["참석자를 다시 확인해 주세요"] },
  });
}

export function assertParticipantCapacity({
  capacity,
  attendeeCount,
  participantCount,
}: {
  capacity: number | null;
  attendeeCount: number | null | undefined;
  participantCount: number;
}) {
  if (capacity !== null && participantCount + 1 > capacity)
    throw new ActionError("OVER_CAPACITY", { message: "participants" });
  if (attendeeCount != null && participantCount + 1 > attendeeCount)
    throw new ActionError("INVALID_INPUT", {
      fieldErrors: {
        attendeeCount: [
          "사용 인원은 나와 참석자를 합친 수 이상으로 입력해 주세요",
        ],
      },
    });
}

export function assertParticipantEligibility(
  ownerId: string,
  participants: readonly BookingParticipantInput[],
  rows: readonly {
    id: string;
    email: string;
    emailVerified: boolean;
    sharesTeam: boolean;
  }[],
) {
  let guests = 0;
  for (const participant of participants) {
    const user = rows.find(({ id }) => id === participant.userId);
    if (participant.userId === ownerId || !user?.emailVerified)
      invalidParticipants();
    if (!user.sharesTeam) {
      guests++;
      if (participant.email?.toLowerCase() !== user.email.toLowerCase())
        invalidParticipants();
    }
  }
  if (guests > MAX_GUEST_PARTICIPANTS) invalidParticipants();
}
