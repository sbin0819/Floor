import { getEnv } from "@/lib/env";
import type { EmailSender } from "./types";

export function createConsoleEmailSender(
  options: {
    getMode?: () => string;
    log?: (message: string) => void;
  } = {},
): EmailSender {
  const getMode = options.getMode ?? (() => getEnv().NODE_ENV);
  const log = options.log ?? console.info;
  return {
    async send(message) {
      if (getMode() === "production") {
        throw new Error("Console email delivery is disabled in production.");
      }
      log(
        `받는 사람: ${message.to}\n제목: ${message.subject}\n\n${message.text}`,
      );
    },
  };
}
