import { describe, expect, it, vi } from "vitest";
import { createConsoleEmailSender } from "@/lib/email/console";
import { createMemoryEmailSender } from "@/lib/email/memory";
import {
  existingAccountEmail,
  passwordResetEmail,
  socialAccountLinkedEmail,
  verificationEmail,
} from "@/lib/email/templates";

const input = {
  to: "member@example.test",
  url: "https://floor.example.test/verify?token=fixture",
};

describe("email delivery", () => {
  it("prints complete development emails including links", async () => {
    const log = vi.fn();
    const message = verificationEmail(input);
    await createConsoleEmailSender({ getMode: () => "development", log }).send(
      message,
    );
    expect(log).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining(input.url),
    );
    expect(log.mock.calls[0]?.[0]).toContain(input.to);
    expect(log.mock.calls[0]?.[0]).toContain(message.subject);
  });
  it("throws without logging anything in production", async () => {
    const log = vi.fn();
    await expect(
      createConsoleEmailSender({ getMode: () => "production", log }).send(
        verificationEmail(input),
      ),
    ).rejects.toThrow("disabled");
    expect(log).not.toHaveBeenCalled();
  });
  it("collects independent messages in memory", async () => {
    const sender = createMemoryEmailSender();
    const message = verificationEmail(input);
    await sender.send(message);
    message.text = "changed";
    expect(sender.messages).toEqual([verificationEmail(input)]);
    expect(createMemoryEmailSender().messages).toEqual([]);
  });
  it("warns against verifying an unsolicited signup", () => {
    expect(verificationEmail(input).text).toContain(
      "가입한 적이 없으면 링크를 누르지 마세요",
    );
  });
  it.each([verificationEmail, passwordResetEmail, existingAccountEmail])(
    "creates text emails with the destination and link",
    (template) => {
      expect(template(input)).toMatchObject({
        to: input.to,
        text: expect.stringContaining(input.url),
        subject: expect.any(String),
      });
    },
  );
  it("explains credential and session removal after social linking", () => {
    const message = socialAccountLinkedEmail({ ...input, provider: "Google" });
    expect(message.text).toContain("Google");
    expect(message.text).toContain("이전 비밀번호와 로그인 세션");
    expect(message.text).toContain(input.url);
  });
});
