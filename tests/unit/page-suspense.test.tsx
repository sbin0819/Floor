import { render, screen } from "@testing-library/react";
import {
  isValidElement,
  Suspense,
  type ReactNode,
  type SuspenseProps,
} from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Home from "@/app/(app)/page";
import TeamPage from "@/app/(app)/teams/[teamId]/page";
import TeamStartPage from "@/app/(app)/teams/start/page";
import InvitePage from "@/app/(app)/invite/[token]/page";
import AdminHome from "@/app/admin/page";
import { requireOperatorPage, requirePageSession } from "@/lib/auth/session";
import {
  getInvitePageData,
  getTeamPageData,
  getTeamStartData,
} from "@/features/teams/queries";
import {
  getHomeTodo,
  getHomeChecklist,
  getHomeRecentChats,
} from "@/features/home/queries";
import { getOperatorHome } from "@/features/admin/queries";

vi.mock("@/lib/auth/session", () => ({
  requirePageSession: vi.fn(),
  requireOperatorPage: vi.fn(),
}));
vi.mock("@/features/teams/queries", () => ({
  getInvitePageData: vi.fn(),
  getTeamPageData: vi.fn(),
  getTeamStartData: vi.fn(),
}));
vi.mock("@/features/home/queries", () => ({
  getHomeTodo: vi.fn(),
  getHomeChecklist: vi.fn(),
  getHomeRecentChats: vi.fn(),
}));
vi.mock("@/features/home/actions", () => ({ dismissHomeChecklist: vi.fn() }));
vi.mock("@/features/admin/queries", () => ({ getOperatorHome: vi.fn() }));
vi.mock("@/features/bookings/actions", () => ({ cancelBooking: vi.fn() }));
vi.mock("@/features/teams/components/team-detail", () => ({
  TeamDetail: () => null,
}));
vi.mock("@/features/teams/components/team-settings", () => ({
  TeamSettings: () => null,
}));
vi.mock("@/features/teams/components/team-bookings", () => ({
  TeamBookings: () => null,
}));
vi.mock("@/features/teams/components/team-removal", () => ({
  TeamRemoval: () => null,
}));
vi.mock("@/features/teams/components/team-delete", () => ({
  TeamDelete: () => null,
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
      const boundary =
        route === "home"
          ? Home().props.header
          : route === "admin"
            ? AdminHome().props.children
            : shell;
      if (!isValidElement<SuspenseProps>(boundary)) {
        throw new Error("The page must return its fallback synchronously");
      }
      expect(boundary.type).toBe(Suspense);
      expect(isValidElement(boundary.props.children)).toBe(true);
      const { container } = render(boundary.props.fallback as ReactNode);
      expect(screen.getAllByRole("status")).toHaveLength(1);
      expect(screen.getByRole("status")).toHaveTextContent("불러오고 있어요.");
      expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
      const skeletons = container.querySelectorAll('[data-slot="skeleton"]');
      if (route === "team-start") {
        expect(skeletons).toHaveLength(1);
        expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
          "팀 회원으로 전환",
        );
        expect(
          screen.getByRole("link", { name: "새 팀 만들기" }),
        ).toHaveAttribute("href", "/teams/start?mode=create");
        expect(screen.getByRole("link", { name: "팀 찾기" })).toHaveAttribute(
          "href",
          "/teams/start?mode=join",
        );
      } else expect(skeletons.length).toBeGreaterThan(1);

      expect(teamParams.read).not.toHaveBeenCalled();
      expect(inviteParams.read).not.toHaveBeenCalled();
      expect(searchParams.read).not.toHaveBeenCalled();
      expect(requirePageSession).not.toHaveBeenCalled();
      expect(requireOperatorPage).not.toHaveBeenCalled();
      expect(getHomeTodo).not.toHaveBeenCalled();
      expect(getHomeChecklist).not.toHaveBeenCalled();
      expect(getHomeRecentChats).not.toHaveBeenCalled();
      expect(getTeamPageData).not.toHaveBeenCalled();
      expect(getTeamStartData).not.toHaveBeenCalled();
      expect(getInvitePageData).not.toHaveBeenCalled();
      expect(getOperatorHome).not.toHaveBeenCalled();
    },
  );
});
