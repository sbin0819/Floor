import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoungeJoinButton } from "@/features/bookings/components/lounge-join-button";
import { BranchNavigation } from "@/features/bookings/components/branch-navigation";
import { BranchCard } from "@/features/bookings/components/branch-card";
import { joinLounge } from "@/features/chat/space-actions";
import type { BranchLounge } from "@/features/bookings/types";
import { floorDayFixture } from "./booking-ui-fixtures";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useSelectedLayoutSegments: () => ["floors", "floor"],
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/features/chat/space-actions", () => ({ joinLounge: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
const lounge = { spaceId: "lounge", joined: false };
const frame = (children: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient()}>
    {children}
  </QueryClientProvider>
);
beforeEach(() => vi.resetAllMocks());

describe("branch lounge entry", () => {
  it("opens an existing membership with a real link and no write", () => {
    render(
      <LoungeJoinButton
        branchId="branch"
        lounge={{ ...lounge, joined: true }}
      />,
    );
    expect(screen.getByRole("link", { name: "라운지 열기" })).toHaveAttribute(
      "href",
      "/s/lounge",
    );
    expect(joinLounge).not.toHaveBeenCalled();
  });

  it("locks immediate duplicate submissions and navigates only after successful membership", async () => {
    let resolve!: (value: Awaited<ReturnType<typeof joinLounge>>) => void;
    vi.mocked(joinLounge).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    render(
      frame(
        <LoungeJoinButton
          branchId="branch"
          lounge={{ spaceId: null, joined: false }}
        />,
      ),
    );
    const button = screen.getByRole("button", { name: "라운지 참여" });
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    await waitFor(() =>
      expect(joinLounge).toHaveBeenCalledExactlyOnceWith({
        branchId: "branch",
      }),
    );
    expect(
      screen.getByRole("button", { name: "참여하고 있어요" }),
    ).toBeDisabled();
    expect(router.push).not.toHaveBeenCalled();
    await act(async () =>
      resolve({ ok: true, data: { spaceId: "created-lounge" } }),
    );
    expect(router.push).toHaveBeenCalledExactlyOnceWith("/s/created-lounge");
  });

  it.each([
    [{ ok: false, code: "UNAUTHENTICATED" }, "다시 로그인해 주세요"],
    [
      { ok: false, code: "LIMIT_EXCEEDED", message: "space_join_count" },
      "스페이스에는 100개까지 들어갈 수 있어요",
    ],
    [
      { ok: false, code: "NOT_FOUND", message: "private data" },
      "이미 처리됐거나 더 볼 수 없는 항목이에요",
    ],
  ] as const)(
    "shows a safe retryable result for %j",
    async (result, message) => {
      vi.mocked(joinLounge).mockResolvedValue(result);
      render(frame(<LoungeJoinButton branchId="branch" lounge={lounge} />));
      fireEvent.click(screen.getByRole("button", { name: "라운지 참여" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(message);
      expect(screen.getByRole("button", { name: "라운지 참여" })).toBeEnabled();
      expect(screen.queryByText("private data")).not.toBeInTheDocument();
      expect(router.push).not.toHaveBeenCalled();
    },
  );

  it("keeps a network failure local without exposing its error", async () => {
    vi.mocked(joinLounge).mockRejectedValue(
      new Error("private database detail"),
    );
    render(frame(<LoungeJoinButton branchId="branch" lounge={lounge} />));
    fireEvent.click(screen.getByRole("button", { name: "라운지 참여" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "처리하지 못했어요. 다시 시도해 주세요",
    );
    expect(
      screen.queryByText("private database detail"),
    ).not.toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "connects both the card and branch header for joined=%s",
    (joined) => {
      const data = floorDayFixture();
      const value: BranchLounge = { ...lounge, joined };
      render(
        frame(
          <>
            <BranchCard
              branch={{
                ...data.branch,
                lounge: value,
                isDefault: true,
                todayHours: data.openHours,
                operatingState: data.operatingState,
                accessibleFloorCount: 1,
                bookableSpaceCount: 2,
                freeSpaceCount: 1,
              }}
              onSetDefault={() => {}}
            />
            <BranchNavigation
              data={{
                branch: data.branch,
                floors: data.floors,
                lounge: value,
                branches: [],
                today: data.date,
                now: data.now,
              }}
            />
          </>,
        ),
      );
      const entries = screen.getAllByRole(joined ? "link" : "button", {
        name: joined ? "라운지 열기" : "라운지 참여",
      });
      expect(entries).toHaveLength(2);
      const cardEntry = entries.find((entry) => entry.closest("article"))!;
      expect(cardEntry.closest(".relative.z-20")).not.toBeNull();
      expect(joinLounge).not.toHaveBeenCalled();
    },
  );
});
