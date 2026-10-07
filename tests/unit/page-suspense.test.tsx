import { render, screen } from "@testing-library/react";
import { isValidElement, Suspense, type SuspenseProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Home from "@/app/(app)/page";
import TeamPage from "@/app/(app)/teams/[teamId]/page";
import TeamStartPage from "@/app/(app)/teams/start/page";
import InvitePage from "@/app/(app)/invite/[token]/page";
import AdminHome from "@/app/admin/page";
import { requireOperatorPage, requirePageSession } from "@/lib/auth/session";
import {
  getHomeTeams,
  getInvitePageData,
  getTeamPageData,
  getTeamStartData,
} from "@/features/teams/queries";
import { getOperatorHome } from "@/features/admin/queries";

vi.mock("@/lib/auth/session", () => ({
  requirePageSession: vi.fn(),
  requireOperatorPage: vi.fn(),
}));
vi.mock("@/features/teams/queries", () => ({
  getHomeTeams: vi.fn(),
  getInvitePageData: vi.fn(),
  getTeamPageData: vi.fn(),
  getTeamStartData: vi.fn(),
}));
vi.mock("@/features/admin/queries", () => ({ getOperatorHome: vi.fn() }));
vi.mock("@/features/teams/components/team-home", () => ({
  TeamHome: () => null,
}));
vi.mock("@/features/teams/components/team-detail", () => ({
  TeamDetail: () => null,
}));
vi.mock("@/features/teams/components/team-start", () => ({
  TeamStart: () => null,
}));
vi.mock("@/features/teams/components/invite-detail", () => ({
  InviteDetail: () => null,
}));

function trackRouteData<T>() {
  const read = vi.fn();
  const pending = new Promise<T>(() => {});
  const promise = new Proxy(pending, {
    get(target, property) {
      read(property);
      if (property === "then") return target.then.bind(target);
      return Reflect.get(target, property);
    },
  });
  return { promise, read };
}

beforeEach(() => vi.clearAllMocks());

describe("protected page-local streaming boundaries", () => {
  it.each(["home", "team", "team-start", "invite", "admin"] as const)(
    "%s provides a synchronous fallback before reading request data",
    (route) => {
      const teamParams = trackRouteData<{ teamId: string }>();
      const inviteParams = trackRouteData<{ token: string }>();
      const searchParams =
        trackRouteData<Record<string, string | string[] | undefined>>();
      const pages = {
        home: () => Home(),
        team: () => TeamPage({ params: teamParams.promise }),
        "team-start": () =>
          TeamStartPage({ searchParams: searchParams.promise }),
        invite: () => InvitePage({ params: inviteParams.promise }),
        admin: () => AdminHome(),
      };

      const shell = pages[route]();
      expect(isValidElement(shell)).toBe(true);
      if (!isValidElement<SuspenseProps>(shell)) {
        throw new Error("The page must return its fallback synchronously");
      }
      expect(shell.type).toBe(Suspense);
      expect(isValidElement(shell.props.children)).toBe(true);
      const { container } = render(shell.props.fallback);
      expect(screen.getAllByRole("status")).toHaveLength(1);
      expect(screen.getByRole("status")).toHaveTextContent("불러오고 있어요.");
      expect(container.firstElementChild).toHaveAttribute("aria-busy", "true");
      expect(
        container.querySelectorAll('[data-slot="skeleton"]').length,
      ).toBeGreaterThan(1);

      expect(teamParams.read).not.toHaveBeenCalled();
      expect(inviteParams.read).not.toHaveBeenCalled();
      expect(searchParams.read).not.toHaveBeenCalled();
      expect(requirePageSession).not.toHaveBeenCalled();
      expect(requireOperatorPage).not.toHaveBeenCalled();
      expect(getHomeTeams).not.toHaveBeenCalled();
      expect(getTeamPageData).not.toHaveBeenCalled();
      expect(getTeamStartData).not.toHaveBeenCalled();
      expect(getInvitePageData).not.toHaveBeenCalled();
      expect(getOperatorHome).not.toHaveBeenCalled();
    },
  );
});
