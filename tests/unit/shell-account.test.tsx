import { screen } from "@testing-library/react";
import { renderWithQuery as render } from "../helpers/query-render";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AccountMenuPlaceholder,
  HeaderAccount,
} from "@/components/shell-account";
import { getAccountMenuData } from "@/features/auth/queries";
import { getSession } from "@/lib/auth/session";
import type { Session } from "@/lib/auth/types";

vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("@/features/auth/queries", () => ({ getAccountMenuData: vi.fn() }));
vi.mock("@/lib/auth/client", () => ({ authClient: { signOut: vi.fn() } }));
vi.mock("@/features/people/actions", () => ({ setStatus: vi.fn() }));

const session: Session = {
  userId: "e10c07ac-715a-4071-bce5-e2b8f117a2ac",
  name: "가상 회원",
  email: "member@example.test",
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getSession).mockResolvedValue(session);
  vi.mocked(getAccountMenuData).mockResolvedValue({
    name: session.name,
    email: session.email,
    isOperator: false,
    myStatus: "online",
    username: null,
  });
});

describe("shell account slots", () => {
  it.each(["pill", "card", "avatar"] as const)(
    "returns no %s slot or account query without a session",
    async (variant) => {
      vi.mocked(getSession).mockResolvedValue(null);
      expect(await HeaderAccount({ variant })).toBeNull();
      expect(getAccountMenuData).not.toHaveBeenCalled();
    },
  );

  it.each(["pill", "card", "avatar"] as const)(
    "passes %s appearance and only the existing profile data",
    async (variant) => {
      const result = await HeaderAccount({ variant });
      expect(result?.props).toEqual({
        variant,
        name: session.name,
        email: session.email,
        isOperator: false,
        myStatus: "online",
        username: null,
      });
      render(result);
      expect(
        screen.getByRole("button", { name: `${session.name}님 사용자 메뉴` }),
      ).toBeVisible();
      expect(getSession).toHaveBeenCalledTimes(1);
      expect(getAccountMenuData).toHaveBeenCalledTimes(1);
    },
  );

  it("waits for the session before reading account data", async () => {
    const pending = Promise.withResolvers<Session | null>();
    vi.mocked(getSession).mockReturnValue(pending.promise);
    const account = HeaderAccount({ variant: "card" });
    expect(getAccountMenuData).not.toHaveBeenCalled();
    pending.resolve(session);
    await account;
    expect(getAccountMenuData).toHaveBeenCalledTimes(1);
  });

  it.each([
    { variant: "pill", classes: ["h-11", "w-36", "rounded-full"] },
    { variant: "card", classes: ["h-14", "w-full", "rounded-lg"] },
    { variant: "avatar", classes: ["size-11", "rounded-full"] },
  ] as const)(
    "reserves the $variant trigger size synchronously",
    ({ variant, classes }) => {
      const { container } = render(
        <AccountMenuPlaceholder variant={variant} />,
      );
      expect(container.firstElementChild).toHaveClass(...classes);
      expect(container.firstElementChild).toHaveAttribute("aria-busy", "true");
      expect(screen.getByRole("status")).toHaveTextContent("불러오고 있어요");
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
      expect(getSession).not.toHaveBeenCalled();
      expect(getAccountMenuData).not.toHaveBeenCalled();
    },
  );
});
