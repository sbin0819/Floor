import { expect, it } from "vitest";
import { teamInviteEmail } from "@/lib/email/templates";

const input = {
  to: "recipient@example.test",
  teamName: "가상 팀",
  senderName: "초대 관리자",
  message: "함께 일해요.",
  url: "https://floor.example.test/invite/fixture-token",
  expiresAt: new Date("2030-01-08T03:00:00Z"),
};

it("includes team, sender, message, the invitation link, and expiry in a text email", () => {
  const email = teamInviteEmail(input);
  expect(email.to).toBe(input.to);
  expect(email.subject).toContain(input.teamName);
  for (const value of [
    input.teamName,
    input.senderName,
    input.message,
    input.url,
    "2030",
    "한국 시간",
    "초대받은 이메일",
    "이메일로 새로 가입",
    "받은 초대",
  ])
    expect(email.text).toContain(value);
});
it("does not add an empty message section", () => {
  const email = teamInviteEmail({ ...input, message: null });
  expect(email.text).not.toContain("보낸 메시지:");
  expect(email.text).toContain(input.url);
});
