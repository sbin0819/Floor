import { ActionError } from "@/lib/actions/result";
import type { BookingParticipantInput } from "./participant-input";
import { MAX_GUEST_PARTICIPANTS } from "./participants";

export function invalidParticipants(): never {
  throw new ActionError("INVALID_INPUT", {
    fieldErrors: {
      participants: ["초대할 수 없는 사람이 있어요. 다시 찾아서 넣어 주세요"],
    },
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
        attendeeCount: ["참석자 수보다 적을 수 없어요"],
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
    blocked: boolean;
  }[],
) {
  let guests = 0;
  for (const participant of participants) {
    const user = rows.find(({ id }) => id === participant.userId);
    if (participant.userId === ownerId || !user?.emailVerified || user.blocked)
      invalidParticipants();
    if (!user.sharesTeam) {
      guests++;
      if (participant.email?.toLowerCase() !== user.email.toLowerCase())
        invalidParticipants();
    }
  }
  if (guests > MAX_GUEST_PARTICIPANTS) invalidParticipants();
}
