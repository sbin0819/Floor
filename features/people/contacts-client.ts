import { z } from "zod";
import { avatarSchema } from "@/lib/avatar";
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
  const response = await fetch("/api/people/contacts", {
    signal,
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok)
    throw new Error("사람 목록을 불러오지 못했어요. 잠시 뒤 다시 열어 주세요");
  return contactsSchema.parse(await response.json());
}
