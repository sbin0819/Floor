import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SpaceTable } from "@/features/admin/components/space-table";
import { adminSpacePath } from "@/features/admin/space-detail-navigation";
import { adminFloorFixture, adminSpaceFixture } from "./admin-ui-fixtures";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/admin",
}));
vi.mock("@/features/admin/actions", () => ({
  archiveSpace: vi.fn(),
  restoreSpace: vi.fn(),
  updateSpace: vi.fn(),
  createSpace: vi.fn(),
  setFloorAccess: vi.fn(),
  setSpaceAccess: vi.fn(),
}));
const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
});
describe("operator space names link to scoped detail pages", () => {
  it.each([true, false])(
    "links every visible space independently of management permission=%s",
    (manageSpaces) => {
      const data = adminFloorFixture();
      data.permissions.manageSpaces = manageSpaces;
      data.spaces.push({
        ...adminSpaceFixture(),
        id: "second",
        name: "다른 회의실",
      });
      const client = new QueryClient();
      clients.push(client);
      render(
        <QueryClientProvider client={client}>
          <SpaceTable data={data} />
        </QueryClientProvider>,
      );
      for (const space of data.spaces) {
        const link = screen.getByRole("link", { name: space.name });
        expect(link).toHaveAttribute(
          "href",
          adminSpacePath(data.branch.id, data.floor.id, space.id),
        );
        expect(link).toHaveClass("min-h-11");
        expect(link).not.toHaveAttribute("aria-disabled");
        expect(
          screen.getByRole("button", { name: `${space.name} 동작` }),
        ).toBeVisible();
      }
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    },
  );
  it("hides an archived space link until its existing visibility control is enabled", async () => {
    const data = adminFloorFixture();
    data.spaces[0]!.archivedAt = "2026-10-07T00:00:00Z";
    const client = new QueryClient();
    clients.push(client);
    render(
      <QueryClientProvider client={client}>
        <SpaceTable data={data} />
      </QueryClientProvider>,
    );
    expect(
      screen.queryByRole("link", { name: data.spaces[0]!.name }),
    ).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("switch", { name: "보관된 공간 보기" }),
    );
    expect(
      screen.getByRole("link", { name: data.spaces[0]!.name }),
    ).toHaveAttribute(
      "href",
      adminSpacePath(data.branch.id, data.floor.id, data.spaces[0]!.id),
    );
    expect(screen.getByText("보관됨")).toBeVisible();
  });
});
