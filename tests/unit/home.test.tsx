import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import Home from "@/app/(app)/page";
import { requirePageSession } from "@/lib/auth/session";

vi.mock("@/lib/auth/session", () => ({ requirePageSession: vi.fn() }));

it("checks the session on the page and greets the current member", async () => {
  vi.mocked(requirePageSession).mockResolvedValue({
    userId: "member",
    email: "member@example.test",
    name: "가상 회원",
  });
  render(await Home());
  expect(requirePageSession).toHaveBeenCalledWith("/");
  expect(
    screen.getByRole("heading", { name: "안녕하세요, 가상 회원님" }),
  ).toBeVisible();
});
