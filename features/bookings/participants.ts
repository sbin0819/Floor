import { z } from "zod";
import type { Avatar } from "@/lib/avatar";
import { normalizeTeamName } from "@/lib/teams/normalize";

export const MAX_PARTICIPANTS = 20;
export const MAX_GUEST_PARTICIPANTS = 5;

export type ParticipantSearchResult = {
  userId: string;
  name: string;
  avatar: Avatar;
  sharedTeamNames: string[];
  maskedEmail: string;
};

export type BookingParticipantDraft = ParticipantSearchResult & {
  email?: string;
};

export const participantQuerySchema = z
  .string()
  .transform(normalizeTeamName)
  .pipe(z.string().min(2).max(254));

export function maskParticipantEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "•••";
  const local = [...email.slice(0, at)];
  return `${local.slice(0, local.length <= 2 ? 1 : 2).join("")}•••${email.slice(at)}`;
}
