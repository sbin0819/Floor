import { z } from "zod";
import { avatarSchema } from "@/lib/avatar";
import { requestJson } from "@/lib/http/client";
import type { MessageContact } from "./types";

const contactsSchema = z.array(
  z
    .object({
      userId: z.uuid(),
      name: z.string(),
      avatar: avatarSchema,
      username: z.string().nullable(),
      sharedTeamNames: z.array(z.string()),
      directRoomId: z.uuid().nullable(),
      isFriend: z.boolean(),
    })
    .strict(),
);

export async function fetchMessageContacts(
  signal: AbortSignal,
): Promise<MessageContact[]> {
  return requestJson("/api/people/contacts", contactsSchema, { signal });
}
