import { Suspense } from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import EditorPage from "@/app/admin/(editor)/branches/[branchId]/floors/[floorId]/plan/page";
import PlansPage from "@/app/admin/(shell)/branches/[branchId]/plans/page";
import { getPlanEditor } from "@/features/floor-plan/queries";
import { getAdminPlans } from "@/features/admin/queries";
import { requireOperatorPage } from "@/lib/auth/session";
import { PlanEditor } from "@/features/floor-plan/editor/plan-editor";
import { AdminForbidden } from "@/features/admin/components/admin-forbidden";
import { AdminPlans } from "@/features/admin/components/admin-plans";
import { planEditorFixture, planEditorIds } from "@/tests/helpers/plan-editor";
import { ActionError } from "@/lib/actions/result";
import { resolvePageContent } from "./page-test-utils";
vi.mock("@/features/floor-plan/queries", () => ({ getPlanEditor: vi.fn() }));
vi.mock("@/features/admin/queries", () => ({ getAdminPlans: vi.fn() }));
vi.mock("@/features/floor-plan/editor/plan-editor", () => ({
  PlanEditor: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireOperatorPage: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
const params = () =>
  Promise.resolve({
    branchId: planEditorIds.branch,
    floorId: planEditorIds.floor,
  });
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireOperatorPage).mockResolvedValue({
    userId: "operator",
    name: "운영자",
    email: "admin@example.test",
  });
  vi.mocked(getPlanEditor).mockResolvedValue(planEditorFixture());
  vi.mocked(getAdminPlans).mockResolvedValue({
    branch: planEditorFixture().branch,
    floors: [],
  });
});
it("shows the fixed editor skeleton before session, params and data reads", () => {
  const page = EditorPage({ params: params() });
  expect(page.type).toBe(Suspense);
  expect(requireOperatorPage).not.toHaveBeenCalled();
  expect(getPlanEditor).not.toHaveBeenCalled();
  render(page.props.fallback);
  expect(screen.getAllByRole("heading", { name: /평면도 편집/ })).toHaveLength(
    2,
  );
  expect(
    screen.getByRole("heading", { name: "도형 속성" }),
  ).toBeInTheDocument();
  expect(screen.queryByText("가상 강남점")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "게시" }),
  ).not.toBeInTheDocument();
});
it("guards before querying and keeps the editor keyed to the owned floor", async () => {
  const page = await resolvePageContent(EditorPage({ params: params() }));
  expect(page.type).toBe(PlanEditor);
  expect(page.key).toBe(planEditorIds.floor);
  expect(getPlanEditor).toHaveBeenCalledExactlyOnceWith({
    branchId: planEditorIds.branch,
    floorId: planEditorIds.floor,
  });
  expect(
    vi.mocked(requireOperatorPage).mock.invocationCallOrder[0],
  ).toBeLessThan(vi.mocked(getPlanEditor).mock.invocationCallOrder[0]!);
});
it("only forwards a UUID reload marker without changing the floor key", async () => {
  const marker = "d8000000-0000-4000-8000-000000000001";
  const page = await resolvePageContent(
    EditorPage({
      params: params(),
      searchParams: Promise.resolve({ reload: marker }),
    }),
  );
  expect(page.props.readKey).toBe(marker);
  const invalid = await resolvePageContent(
    EditorPage({
      params: params(),
      searchParams: Promise.resolve({ reload: "unsafe" }),
    }),
  );
  expect(invalid.props.readKey).toBeNull();
});
it("does not query after session redirect and does not invent an empty editor on failures", async () => {
  vi.mocked(requireOperatorPage).mockRejectedValueOnce(new Error("LOGIN"));
  await expect(
    resolvePageContent(EditorPage({ params: params() })),
  ).rejects.toThrow("LOGIN");
  expect(getPlanEditor).not.toHaveBeenCalled();
  vi.mocked(getPlanEditor).mockRejectedValueOnce(new ActionError("FORBIDDEN"));
  expect(
    (await resolvePageContent(EditorPage({ params: params() }))).type,
  ).toBe(AdminForbidden);
  vi.mocked(getPlanEditor).mockRejectedValueOnce(new ActionError("NOT_FOUND"));
  await expect(
    resolvePageContent(EditorPage({ params: params() })),
  ).rejects.toThrow("NOT_FOUND");
  vi.mocked(getPlanEditor).mockRejectedValueOnce(new Error("DB"));
  await expect(
    resolvePageContent(EditorPage({ params: params() })),
  ).rejects.toThrow("DB");
});
it("independently guards the plans list and shows an honest empty state", async () => {
  const page = PlansPage({ params: params() });
  expect(page.type).toBe(Suspense);
  expect(getAdminPlans).not.toHaveBeenCalled();
  const content = await resolvePageContent(page);
  expect(content.type).toBe(AdminPlans);
  expect(getAdminPlans).toHaveBeenCalledExactlyOnceWith(planEditorIds.branch);
  render(content);
  expect(screen.getByText("아직 등록한 층이 없어요")).toBeVisible();
});
it("renders only authorized metadata and the editor link from the plans query", () => {
  render(
    <AdminPlans
      data={{
        branch: planEditorFixture().branch,
        floors: [
          {
            id: planEditorIds.floor,
            name: "6F",
            published: {
              planId: planEditorIds.plan,
              version: 1,
              publishedAt: "2026-10-09T00:00:00.000Z",
            },
            draft: {
              planId: "draft",
              version: 2,
              updatedAt: "2026-10-09T02:42:00.000Z",
              updatedByName: "김도윤",
            },
          },
        ],
      }}
    />,
  );
  expect(screen.getByRole("link", { name: "6F 평면도 편집" })).toHaveAttribute(
    "href",
    `/admin/branches/${planEditorIds.branch}/floors/${planEditorIds.floor}/plan`,
  );
  expect(screen.getByText(/게시본 · 버전 1/)).toBeVisible();
  expect(screen.getByText(/초안 ·.*11:42 김도윤/)).toBeVisible();
});
