import { beforeEach, describe, expect, it, vi } from "vitest";
import MeetingPage from "@/app/(app)/m/[bookingId]/page";
import { MeetingScreen } from "@/features/chat/components/channel-screen";
import { resolvePageContent } from "./page-test-utils";
import { meetingView } from "../helpers/meeting";
const mocks = vi.hoisted(() => ({ guard: vi.fn(), view: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requirePageSession: mocks.guard }));
vi.mock("@/features/chat/queries", () => ({ getMeetingView: mocks.view }));
vi.mock("@/features/chat/components/channel-screen", () => ({
  MeetingScreen: () => null,
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("not-found");
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockResolvedValue(undefined);
  mocks.view.mockResolvedValue(meetingView());
});
describe("meeting page", () => {
  it("keeps unknown booking/session data under Suspense and uses its own page guard", async () => {
    const data = meetingView();
    const page = MeetingPage({
      params: Promise.resolve({ bookingId: data.booking.id }),
    });
    expect(mocks.guard).not.toHaveBeenCalled();
    expect(mocks.view).not.toHaveBeenCalled();
    const content = await resolvePageContent(page);
    expect(mocks.guard).toHaveBeenCalledWith(`/m/${data.booking.id}`);
    expect(mocks.view).toHaveBeenCalledWith(data.booking.id);
    expect(mocks.guard.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.view.mock.invocationCallOrder[0]!,
    );
    expect(content.type).toBe(MeetingScreen);
    expect(content.props.data).toEqual(data);
  });
  it("does not start a query when session guard redirects", async () => {
    mocks.guard.mockRejectedValue(new Error("login"));
    await expect(
      resolvePageContent(
        MeetingPage({ params: Promise.resolve({ bookingId: "booking" }) }),
      ),
    ).rejects.toThrow("login");
    expect(mocks.view).not.toHaveBeenCalled();
  });
  it.each(["invalid", "b1111111-1111-4111-8111-111111111111"])(
    "uses the same missing screen for unavailable %s",
    async (bookingId) => {
      mocks.view.mockResolvedValue(null);
      await expect(
        resolvePageContent(
          MeetingPage({ params: Promise.resolve({ bookingId }) }),
        ),
      ).rejects.toThrow("not-found");
    },
  );
});
