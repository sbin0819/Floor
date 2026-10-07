import { getEnv } from "@/lib/env";
import { createConsoleEmailSender } from "./console";

const sender = createConsoleEmailSender();

export function getEmailSender() {
  return sender;
}
export function canSendEmail() {
  return getEnv().NODE_ENV !== "production";
}
export type { EmailMessage, EmailSender } from "./types";
