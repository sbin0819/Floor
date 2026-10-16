import { z } from "zod";
import { avatarSchema } from "@/lib/avatar";
import { requestJson } from "@/lib/http/client";
import type { ParticipantSearchResult } from "./participants";

const resultSchema = z.strictObject({
  userId: z.string().min(1),
  name: z.string().min(1),
  avatar: avatarSchema,
  sharedTeamNames: z.array(z.string()),
  maskedEmail: z.string().regex(/^[^@]{1,2}•••@[^@]+$/u),
});
const responseSchema = z.strictObject({
  results: z.array(resultSchema).max(8),
});

export type SearchParticipants = (
  query: string,
  signal: AbortSignal,
) => Promise<ParticipantSearchResult[]>;

export const fetchParticipants: SearchParticipants = async (query, signal) => {
  const response = await requestJson(
    `/api/participants/search?${new URLSearchParams({ q: query })}`,
    responseSchema,
    { signal },
  );
  return response.results;
};
