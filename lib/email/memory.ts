import type { EmailMessage, EmailSender } from "./types";

export function createMemoryEmailSender(): EmailSender & {
  messages: EmailMessage[];
} {
  const messages: EmailMessage[] = [];
  return {
    messages,
    async send(message) {
      messages.push({ ...message });
    },
  };
}
