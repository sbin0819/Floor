import { isValidElement, Suspense, type ComponentProps } from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import Page from "@/app/admin/(shell)/branches/[branchId]/announcements/page";
import {
  AnnouncementColumns,
  AnnouncementFrame,
  AnnouncementSkeleton,
} from "@/features/admin/components/announcement-frame";
import { AnnouncementForm } from "@/features/admin/components/announcement-form";
import { AdminForbidden } from "@/features/admin/components/admin-forbidden";
import {
  getAnnouncements,
  previewAnnouncementAudience,
} from "@/features/admin/queries";
import { announcementPreviewHref } from "@/features/admin/announcement-navigation";
import { ActionError } from "@/lib/actions/result";
import { requireOperatorPage } from "@/lib/auth/session";
import {
  announcementBranchId,
  announcementPreviewFixture,
  announcementRequest,
  announcementsFixture,
} from "@/tests/helpers/announcements";
import { resolvePageContent } from "./page-test-utils";

vi.mock("@/features/admin/queries", () => ({
  getAnnouncements: vi.fn(),
  previewAnnouncementAudience: vi.fn(),
}));
vi.mock("@/features/admin/announcement-actions", () => ({
  sendAnnouncement: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireOperatorPage: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound() {
    throw new Error("NOT_FOUND");
  },
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireOperatorPage).mockResolvedValue({
    userId: "operator",
    name: "운영자",
    email: "admin@example.test",
  });
  vi.mocked(getAnnouncements).mockResolvedValue(announcementsFixture());
  vi.mocked(previewAnnouncementAudience).mockResolvedValue(
    announcementPreviewFixture(),
  );
});
function page(
  search: Record<string, string | string[] | undefined> = {},
  branchId = announcementBranchId,
) {
  return Page({
    params: Promise.resolve({ branchId }),
    searchParams: Promise.resolve(search),
  });
}
const search = () =>
  Object.fromEntries(
    new URL(
      announcementPreviewHref(announcementRequest()),
      "https://floor.test",
    ).searchParams,
  );
function formFrom(value: unknown) {
  if (
    !isValidElement<ComponentProps<typeof AnnouncementForm>>(value) ||
    value.type !== AnnouncementForm
  )
    throw new Error("Expected retained form");
  return value;
}
it("renders fixed headings before request data and keeps the frame outside Suspense", () => {
  const shell = page();
  expect(shell.type).toBe(AnnouncementFrame);
  expect(shell.props.children.type).toBe(Suspense);
  expect(shell.props.children.props.fallback.type).toBe(AnnouncementSkeleton);
  expect(requireOperatorPage).not.toHaveBeenCalled();
  render(
    <AnnouncementFrame>
      {shell.props.children.props.fallback}
    </AnnouncementFrame>,
  );
  expect(screen.getByRole("heading", { name: "공지" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "보낸 공지" })).toBeVisible();
});
it("requires the page guard before list or preview", async () => {
  vi.mocked(requireOperatorPage).mockRejectedValue(new Error("LOGIN"));
  await expect(
    resolvePageContent(page(search()).props.children),
  ).rejects.toThrow("LOGIN");
  expect(getAnnouncements).not.toHaveBeenCalled();
  expect(previewAnnouncementAudience).not.toHaveBeenCalled();
});
it("starts exactly one independent preview and never uses title/body from URL", async () => {
  const result = await resolvePageContent(
    page({ ...search(), title: "never-use", body: "never-use" }).props.children,
  );
  expect(result.type).toBe(AnnouncementColumns);
  expect(getAnnouncements).toHaveBeenCalledExactlyOnceWith({
    branchId: announcementBranchId,
  });
  expect(previewAnnouncementAudience).toHaveBeenCalledExactlyOnceWith(
    announcementRequest().input,
  );
  const form = formFrom(result.props.form);
  expect(form.key).toBe(announcementBranchId);
  expect(form.props.initialRequest).toEqual(announcementRequest());
  expect(JSON.stringify(form.props)).not.toContain("never-use");
  const preview = await resolvePageContent(form.props.children);
  expect(preview.props.result).toEqual({
    ok: true,
    data: announcementPreviewFixture(),
  });
});
it.each([
  { preview: "bad" },
  { lounge: ["1"] },
  { date: "not-date" },
  { space: "not-id" },
])("ignores malformed preview %j without guessing zero", async (change) => {
  const result = await resolvePageContent(
    page({ ...search(), ...change }).props.children,
  );
  expect(formFrom(result.props.form).props.initialRequest).toBeNull();
  expect(previewAnnouncementAudience).not.toHaveBeenCalled();
});
it.each(["FORBIDDEN", "NOT_FOUND", "INVALID_INPUT"] as const)(
  "shows safe preview %s without raw details",
  async (code) => {
    vi.mocked(previewAnnouncementAudience).mockRejectedValue(
      new ActionError(code),
    );
    const result = await resolvePageContent(page(search()).props.children);
    const preview = await resolvePageContent(
      formFrom(result.props.form).props.children,
    );
    expect(preview.props.result).toEqual({
      ok: false,
      message: expect.any(String),
    });
  },
);
it("does not invent an empty authorized page on list denial", async () => {
  vi.mocked(getAnnouncements).mockRejectedValueOnce(
    new ActionError("FORBIDDEN"),
  );
  expect((await resolvePageContent(page().props.children)).type).toBe(
    AdminForbidden,
  );
  vi.mocked(getAnnouncements).mockRejectedValueOnce(
    new ActionError("NOT_FOUND"),
  );
  await expect(resolvePageContent(page().props.children)).rejects.toThrow(
    "NOT_FOUND",
  );
  await expect(
    resolvePageContent(page({}, "bad").props.children),
  ).rejects.toThrow("NOT_FOUND");
});
