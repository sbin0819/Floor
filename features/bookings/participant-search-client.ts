import { z } from "zod";
import type { ParticipantSearchResult } from "./participants";

const resultSchema = z.strictObject({
  userId: z.string().min(1),
  name: z.string().min(1),
  sharedTeamNames: z.array(z.string()),
  maskedEmail: z.string().regex(/^[^@]{1,2}•••@[^@]+$/u),
});
const responseSchema = z.strictObject({
  results: z.array(resultSchema).max(8),
});

export class ParticipantSearchError extends Error {
  constructor(public readonly status: number) {
    super("Participant search failed");
    this.name = "ParticipantSearchError";
  }
}
export type SearchParticipants = (
  query: string,
  signal: AbortSignal,
) => Promise<ParticipantSearchResult[]>;

export const fetchParticipants: SearchParticipants = async (query, signal) => {
  const response = await fetch(
    `/api/participants/search?${new URLSearchParams({ q: query })}`,
    {
      signal,
      cache: "no-store",
      credentials: "same-origin",
    },
  );
  if (!response.ok) throw new ParticipantSearchError(response.status);
  const body: unknown = await response.json().catch(() => {
    throw new ParticipantSearchError(500);
  });
  const parsed = responseSchema.safeParse(body);
  if (!parsed.success) throw new ParticipantSearchError(500);
  return parsed.data.results;
};
