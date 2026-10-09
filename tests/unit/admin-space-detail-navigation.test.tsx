import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpaceDetail } from "@/features/admin/components/space-detail";
import { SpaceForm } from "@/features/admin/components/space-form";
import { SpacePhotos } from "@/features/admin/components/space-photos";
import { setSpaceAccess } from "@/features/admin/actions";
import {
  adminSpaceHref,
  adminSpacePath,
  spaceDetailTab,
} from "@/features/admin/space-detail-navigation";
import type { AdminSpaceDetailData } from "@/features/admin/space-detail-types";
import {
  adminFloorFixture,
  adminIds,
  adminSpaceFixture,
} from "./admin-ui-fixtures";

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  usePathname: () => window.location.pathname,
}));
vi.mock("@/features/admin/actions", () => ({
  setFloorAccess: vi.fn(),
  setSpaceAccess: vi.fn(),
}));
vi.mock("@/features/admin/components/space-form", () => ({
  SpaceForm: vi.fn(() => <h2>공간 정보 양식</h2>),
}));
vi.mock("@/features/admin/components/space-photos", () => ({
  SpacePhotos: vi.fn(() => <h2>공간 사진 관리</h2>),
}));
const path = adminSpacePath(adminIds.branch, adminIds.floor, adminIds.space);
function fixture(): AdminSpaceDetailData {
  const { spaces, ...floor } = adminFloorFixture();
  return {
    ...floor,
    space: spaces[0]!,
    photos: [
      {
        id: "photo",
        path: "/seed/photos/room.webp",
        alt: "회의실 사진",
        sortOrder: 0,
      },
    ],
    filesEnabled: true,
  };
}
const clients: QueryClient[] = [];
function mount(tab: "info" | "access" | "photos", data = fixture()) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <SpaceDetail data={data} tab={tab} />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  window.history.replaceState({}, "", path);
});
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  vi.unstubAllGlobals();
});

describe("admin space detail URL contract", () => {
  it.each([undefined, null, "", "wrong", ["photos"], { tab: "access" }])(
    "normalizes unsupported tab %j to info",
    (value) => {
      expect(spaceDetailTab(value)).toBe("info");
    },
  );
  it.each(["info", "access", "photos"] as const)(
    "preserves valid %s",
    (value) => expect(spaceDetailTab(value)).toBe(value),
  );
  it("encodes path segments and confines team input to an encoded access query", () => {
    expect(adminSpacePath("b/a", "f?x", "s#hash")).toBe(
      "/admin/branches/b%2Fa/floors/f%3Fx/spaces/s%23hash",
    );
    expect(adminSpaceHref(path, "access", "디자인 & tab=photos")).toBe(
      `${path}?tab=access&team=${encodeURIComponent("디자인 & tab=photos").replaceAll("%20", "+")}`,
    );
    expect(adminSpaceHref(path, "info", "팀")).toBe(path);
    expect(adminSpaceHref(path, "photos", "팀")).toBe(`${path}?tab=photos`);
    expect(adminSpaceHref(path, "access", "")).toBe(`${path}?tab=access`);
  });
  it("keeps breadcrumbs and all three 44px tab destinations as links", () => {
    mount("photos");
    const crumbs = screen.getByRole("navigation", { name: "경로" });
    expect(
      within(crumbs).getByRole("link", { name: "공간 관리" }),
    ).toHaveAttribute("href", `/admin/branches/${adminIds.branch}/spaces`);
    expect(within(crumbs).getByRole("link", { name: "7F" })).toHaveAttribute(
      "href",
      `/admin/branches/${adminIds.branch}/floors/${adminIds.floor}`,
    );
    expect(within(crumbs).getByText("회의실 A")).toHaveAttribute(
      "aria-current",
      "page",
    );
    const tabs = screen.getByRole("navigation", { name: "공간 설정" });
    for (const [name, href] of [
      ["정보", path],
      ["이용 대상", `${path}?tab=access`],
      ["사진 1", `${path}?tab=photos`],
    ]) {
      const link = within(tabs).getByRole("link", { name });
      expect(link).toHaveAttribute("href", href);
      expect(link).toHaveClass("min-h-11");
    }
    expect(within(tabs).getByRole("link", { name: "사진 1" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      screen.queryByRole("heading", { name: "공간 정보 양식" }),
    ).not.toBeInTheDocument();
    expect(vi.mocked(SpacePhotos).mock.calls[0]![0]).toMatchObject({
      spaceId: adminIds.space,
      path,
      enabled: true,
      canManage: true,
    });
  });
  it("navigates photo tabs by keyboard without scrolling or adding a team parameter", async () => {
    mount("info");
    const link = screen.getByRole("link", { name: "사진 1" });
    link.focus();
    await userEvent.keyboard("{Enter}");
    expect(navigation.push).toHaveBeenCalledExactlyOnceWith(
      `${path}?tab=photos`,
      { scroll: false },
    );
    expect(setSpaceAccess).not.toHaveBeenCalled();
  });
  it("does not hijack modifier clicks or an old page after its route was left", () => {
    mount("info");
    const link = screen.getByRole("link", { name: "이용 대상" });
    fireEvent.click(link, { ctrlKey: true });
    fireEvent.click(link, { metaKey: true });
    expect(navigation.push).not.toHaveBeenCalled();
    window.history.replaceState({}, "", "/admin");
    fireEvent.click(link);
    expect(navigation.push).not.toHaveBeenCalled();
  });
  it.each(["button", "keyboard"])(
    "retains the access tab during team search through %s",
    async (method) => {
      const data = fixture();
      data.space = { ...adminSpaceFixture(), access: "teams" };
      mount("access", data);
      const input = screen.getByRole("textbox", { name: "팀 이름으로 찾기" });
      await userEvent.type(input, "디자인 팀");
      if (method === "button")
        await userEvent.click(screen.getByRole("button", { name: "찾기" }));
      else await userEvent.keyboard("{Enter}");
      expect(navigation.replace).toHaveBeenCalledExactlyOnceWith(
        adminSpaceHref(path, "access", "디자인 팀"),
        { scroll: false },
      );
      expect(setSpaceAccess).not.toHaveBeenCalled();
      expect(SpacePhotos).not.toHaveBeenCalled();
    },
  );
  it("clears a team search while keeping tab=access", async () => {
    const data = fixture();
    data.space.access = "teams";
    data.teamSearch = { query: "디자인", valid: true, results: [] };
    mount("access", data);
    await userEvent.clear(
      screen.getByRole("textbox", { name: "팀 이름으로 찾기" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "찾기" }));
    expect(navigation.replace).toHaveBeenCalledExactlyOnceWith(
      `${path}?tab=access`,
      { scroll: false },
    );
  });
  it("passes independent information and photo management permission without inventing authorization", () => {
    const data = fixture();
    data.permissions.manageSpaces = false;
    mount("info", data);
    expect(vi.mocked(SpaceForm).mock.calls[0]![0]).toMatchObject({
      floorId: adminIds.floor,
      space: data.space,
      canManage: false,
    });
  });
});
