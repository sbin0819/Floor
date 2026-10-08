import { z } from "zod";
import { MAX_PARTICIPANTS } from "./participants";

const participantSchema = z.strictObject({
  userId: z.uuid().transform((value) => value.toLowerCase()),
  email: z
    .email()
    .max(254)
    .transform((value) => value.toLowerCase())
    .optional(),
});

export const bookingParticipantsSchema = z
  .array(participantSchema)
  .transform((rows) => [
    ...new Map(rows.map((row) => [row.userId, row])).values(),
  ])
  .pipe(z.array(participantSchema).max(MAX_PARTICIPANTS));

export type BookingParticipantInput = z.infer<typeof participantSchema>;
