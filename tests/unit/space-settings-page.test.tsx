import {
  Children,
  isValidElement,
  Suspense,
  type ReactElement,
  type ReactNode,
} from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Page from "@/app/(app)/s/[spaceId]/settings/page";
import { resolvePageContent } from "./page-test-utils";
const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  settings: vi.fn(),
  members: vi.fn(),
  invites: vi.fn(),
  candidates: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({
  requirePageSession: mocks.guard,
  getSession: vi.fn(),
  requireSession: vi.fn(),
}));
vi.mock("@/features/chat/space-settings-queries", () => ({
  getSpaceSettings: mocks.settings,
}));
vi.mock("@/features/chat/space-members-queries", () => ({
  getSpaceMembers: mocks.members,
}));
vi.mock("@/features/chat/space-invite-queries", () => ({
  getSpaceInvites: mocks.invites,
  getInviteCandidates: mocks.candidates,
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("not-found");
  },
}));
const id = "11111111-1111-4111-8111-111111111111";
const data = {
  id,
  kind: "community",
  name: "가상 모임",
  iconColor: "blue",
  role: "member",
  channels: [],
};
function boundary(node: ReactNode): ReactElement {
  if (isValidElement<{ children?: ReactNode }>(node)) {
    if (node.type === Suspense) return node;
    for (const child of Children.toArray(node.props.children)) {
      try {
        return boundary(child);
      } catch {
        /* 다른 형제에서 찾는다. */
      }
    }
  }
  throw new Error("Missing Suspense");
}
const page = (query = {}) =>
  Page({
    params: Promise.resolve({ spaceId: id }),
    searchParams: Promise.resolve(query),
  });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockResolvedValue({ userId: "me" });
  mocks.settings.mockResolvedValue(data);
  mocks.members.mockResolvedValue({
    space: data,
    view: "full",
    members: [],
    banned: [],
    memberCount: 0,
  });
  mocks.invites.mockResolvedValue([]);
  mocks.candidates.mockResolvedValue([]);
});
describe("space settings page boundaries", () => {
  it("shows the fixed title before params, session or private data resolve", () => {
    const view = Page({
      params: new Promise(() => {}),
      searchParams: new Promise(() => {}),
    });
    const [title, description] = view.props.children;
    render(
      <>
        {title}
        {description}
      </>,
    );
    expect(
      screen.getByRole("heading", { name: "스페이스 설정" }),
    ).toBeVisible();
    expect(mocks.guard).not.toHaveBeenCalled();
    expect(mocks.settings).not.toHaveBeenCalled();
  });
  it("guards the page independently before private metadata", async () => {
    const content = await resolvePageContent(boundary(page()));
    expect(mocks.guard).toHaveBeenCalledWith(`/s/${id}/settings`);
    expect(mocks.guard.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.settings.mock.invocationCallOrder[0]!,
    );
    await resolvePageContent(boundary(content));
    expect(mocks.members).not.toHaveBeenCalled();
    expect(mocks.invites).not.toHaveBeenCalled();
    expect(mocks.candidates).not.toHaveBeenCalled();
  });
  it("uses notFound for invisible settings", async () => {
    mocks.settings.mockResolvedValue(null);
    await expect(resolvePageContent(boundary(page()))).rejects.toThrow(
      "not-found",
    );
    expect(mocks.members).not.toHaveBeenCalled();
  });
  it.each(["banned", "danger", "invalid"])(
    "does not query a forbidden %s tab",
    async (tab) => {
      const content = await resolvePageContent(boundary(page({ tab })));
      await resolvePageContent(boundary(content));
      expect(mocks.members).not.toHaveBeenCalled();
      expect(mocks.invites).not.toHaveBeenCalled();
    },
  );
  it("streams just the requested member list below metadata", async () => {
    const content = await resolvePageContent(
      boundary(page({ tab: "members" })),
    );
    expect(mocks.members).not.toHaveBeenCalled();
    const members = await resolvePageContent(boundary(content));
    expect(mocks.members).toHaveBeenCalledWith(id);
    expect(members.props.currentUserId).toBe("me");
    expect(mocks.invites).not.toHaveBeenCalled();
  });
  it("reads candidates only when the community invite dialog is requested", async () => {
    await resolvePageContent(boundary(page({ invite: "1" })));
    expect(mocks.candidates).toHaveBeenCalledWith(id);
    mocks.candidates.mockClear();
    mocks.settings.mockResolvedValue({ ...data, kind: "branch" });
    await resolvePageContent(boundary(page({ invite: "1" })));
    expect(mocks.candidates).not.toHaveBeenCalled();
  });
});
